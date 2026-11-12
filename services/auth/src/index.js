process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'auth-service';

const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const {
  createApp, finalize, start, express, db, v, logger, metric,
  HttpError, asyncHandler, signToken, requireAuth, requireLibrarian, requireInternalKey,
} = require('../../shared');
const { validatePassword, publicUser } = require('./users');

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

async function init() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(120) NOT NULL,
      email         VARCHAR(254) NOT NULL UNIQUE,
      phone         VARCHAR(20),
      password_hash VARCHAR(100) NOT NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'member' CHECK (role IN ('member','librarian')),
      status        VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )`);

  // Create the first librarian account if none exists.
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'librarian'`);
  if (rows[0].n === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@libracloud.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
    if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
      throw new Error('ADMIN_PASSWORD must be set in production');
    }
    await db.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'librarian')
       ON CONFLICT (email) DO UPDATE SET role = 'librarian'`,
      ['Head Librarian', email, await bcrypt.hash(password, BCRYPT_ROUNDS)],
    );
    logger.info('admin_seeded', { email });
  }
}

const app = createApp();

// Brute-force protection: max 10 login attempts per IP per 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.REGISTER_RATE_LIMIT || 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Try again later.' },
});

async function createUser({ name, email, phone, password, role = 'member' }) {
  validatePassword(password);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, email, phone, hash, role],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists');
    throw err;
  }
}

app.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const user = await createUser({
    name: v.str(req.body, 'name', { required: true, min: 2, max: 120 }),
    email: v.email(req.body, 'email', { required: true }),
    phone: v.str(req.body, 'phone', { max: 20 }),
    password: req.body.password,
  });
  metric('MembersRegistered');
  logger.info('member_registered', { userId: user.id });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = v.email(req.body, 'email', { required: true });
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Always run bcrypt (even for unknown emails) so response time does not reveal which emails exist.
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    metric('LoginFailures');
    logger.warn('login_failed', { email, ip: req.ip });
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (user.status !== 'active') throw new HttpError(403, 'This account is suspended. Please contact the library.');
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  metric('Logins');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  res.json(publicUser(rows[0]));
}));

app.post('/me/password', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(String(req.body.currentPassword || ''), user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect');
  }
  validatePassword(req.body.newPassword);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS), user.id]);
  res.json({ ok: true });
}));

// ---- Librarian: manage members ----
app.get('/users', requireLibrarian, asyncHandler(async (req, res) => {
  const { page, limit, offset } = v.pagination(req.query);
  const q = v.str(req.query, 'q', { max: 100 });
  const role = ['member', 'librarian'].includes(req.query.role) ? req.query.role : null;
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${params.length} OR email LIKE $${params.length})`);
  }
  if (role) {
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*)::int AS n FROM users ${w}`, params)).rows[0].n;
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT * FROM users ${w} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  res.json({ items: rows.map(publicUser), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

app.post('/users', requireLibrarian, asyncHandler(async (req, res) => {
  const role = req.body.role === 'librarian' ? 'librarian' : 'member';
  const user = await createUser({
    name: v.str(req.body, 'name', { required: true, min: 2, max: 120 }),
    email: v.email(req.body, 'email', { required: true }),
    phone: v.str(req.body, 'phone', { max: 20 }),
    password: req.body.password,
    role,
  });
  logger.info('user_created_by_librarian', { userId: user.id, role, by: req.user.id });
  res.status(201).json(publicUser(user));
}));

app.patch('/users/:id/status', requireLibrarian, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const status = req.body.status;
  if (!['active', 'suspended'].includes(status)) throw new HttpError(400, 'status must be active or suspended');
  if (id === req.user.id) throw new HttpError(400, 'You cannot change your own status');
  const { rows } = await db.query('UPDATE users SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  logger.info('user_status_changed', { userId: id, status, by: req.user.id });
  res.json(publicUser(rows[0]));
}));

app.get('/stats', requireLibrarian, asyncHandler(async (_req, res) => {
  const { rows } = await db.query(`
    SELECT
      count(*) FILTER (WHERE role = 'member')::int AS members,
      count(*) FILTER (WHERE role = 'member' AND status = 'active')::int AS active_members,
      count(*) FILTER (WHERE role = 'librarian')::int AS librarians,
      count(*) FILTER (WHERE role = 'member' AND created_at > now() - interval '30 days')::int AS new_members_30d
    FROM users`);
  res.json(rows[0]);
}));

// ---- Internal (service-to-service) ----
const internal = express.Router();
internal.use(requireInternalKey);
internal.get('/users/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'User not found');
  res.json(publicUser(rows[0]));
}));
app.use('/internal', internal);

finalize(app);

if (require.main === module) {
  start(app, { init }).catch((err) => {
    logger.error('startup_failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = app;
