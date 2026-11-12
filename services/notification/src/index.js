process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'notification-service';

const {
  createApp, finalize, start, express, db, v, logger, metric,
  HttpError, asyncHandler, requireAuth, requireLibrarian, requireInternalKey,
} = require('../../shared');
const { sendEmail } = require('./sns');

const TYPES = ['issued', 'returned', 'renewed', 'due_soon', 'overdue', 'fine', 'general'];

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER,
      email       VARCHAR(254),
      type        VARCHAR(30) NOT NULL,
      subject     VARCHAR(200) NOT NULL,
      message     TEXT NOT NULL,
      channel     VARCHAR(20) NOT NULL DEFAULT 'log',
      status      VARCHAR(20) NOT NULL DEFAULT 'pending',
      message_id  VARCHAR(100),
      error       VARCHAR(300),
      read_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC)');
}

const app = createApp();

function publicNotification(n) {
  return {
    id: n.id, userId: n.user_id, email: n.email, type: n.type, subject: n.subject, message: n.message,
    channel: n.channel, status: n.status, read: Boolean(n.read_at), createdAt: n.created_at,
  };
}

async function deliver({ userId, email, name, type, subject, message }) {
  const { rows } = await db.query(
    `INSERT INTO notifications (user_id, email, type, subject, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [userId, email, type, subject, message]);
  const n = rows[0];
  try {
    const r = await sendEmail({ name, email, type, subject, message });
    await db.query('UPDATE notifications SET channel=$1, status=$2, message_id=$3 WHERE id=$4', [r.channel, r.status, r.messageId || null, n.id]);
    metric('NotificationsSent');
    return { ...n, channel: r.channel, status: r.status };
  } catch (err) {
    // The in-app notification is still saved even if email delivery fails.
    await db.query(`UPDATE notifications SET channel='sns', status='failed', error=$1 WHERE id=$2`, [err.message.slice(0, 300), n.id]);
    metric('NotificationsFailed');
    logger.error('notification_send_failed', { id: n.id, error: err.message });
    return { ...n, status: 'failed' };
  }
}

// ---- Member: in-app notification centre ----
app.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  const unread = rows.filter((n) => !n.read_at).length;
  res.json({ items: rows.map(publicNotification), unread });
}));

app.get('/me/unread-count', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ unread: rows[0].n });
}));

app.post('/me/read-all', requireAuth, asyncHandler(async (req, res) => {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

// ---- Librarian: delivery log and announcements ----
app.get('/', requireLibrarian, asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100');
  res.json(rows.map(publicNotification));
}));

app.post('/announce', requireLibrarian, asyncHandler(async (req, res) => {
  const subject = v.str(req.body, 'subject', { required: true, min: 3, max: 150 });
  const message = v.str(req.body, 'message', { required: true, min: 3, max: 2000 });
  const n = await deliver({ userId: null, email: 'all-members', name: 'All members', type: 'general', subject, message });
  logger.info('announcement_sent', { id: n.id, by: req.user.id });
  res.status(201).json(publicNotification(n));
}));

// ---- Internal: other services send notifications here ----
const internal = express.Router();
internal.use(requireInternalKey);
internal.post('/notify', asyncHandler(async (req, res) => {
  const type = TYPES.includes(req.body.type) ? req.body.type : 'general';
  const n = await deliver({
    userId: v.int(req.body.userId, 'userId', { min: 1 }),
    email: v.str(req.body, 'email', { max: 254 }),
    name: v.str(req.body, 'name', { max: 120 }),
    type,
    subject: v.str(req.body, 'subject', { required: true, max: 200 }),
    message: v.str(req.body, 'message', { required: true, max: 4000 }),
  });
  if (n.status === 'failed') throw new HttpError(502, 'Saved, but email delivery failed');
  res.status(201).json(publicNotification(n));
}));
app.use('/internal', internal);

finalize(app);

if (require.main === module) {
  start(app, { init: migrate }).catch((err) => {
    logger.error('startup_failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = app;
