process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'circulation-service';

const crypto = require('crypto');
const {
  createApp, finalize, start, express, db, v, logger, metric, metrics,
  HttpError, asyncHandler, requireAuth, requireLibrarian, requireInternalKey, callService,
} = require('../../shared');
const rules = require('./rules');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS loans (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL,
      book_id          INTEGER NOT NULL,
      user_name        VARCHAR(120),
      user_email       VARCHAR(254),
      book_title       VARCHAR(400),
      book_author      VARCHAR(400),
      issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      due_at           TIMESTAMPTZ NOT NULL,
      returned_at      TIMESTAMPTZ,
      status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','overdue','returned')),
      renewals         INTEGER NOT NULL DEFAULT 0,
      reminder_sent    BOOLEAN NOT NULL DEFAULT false,
      issued_by        INTEGER
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS loans_user_idx ON loans (user_id, status)');
  await db.query('CREATE INDEX IF NOT EXISTS loans_open_idx ON loans (due_at) WHERE returned_at IS NULL');
  await db.query('CREATE INDEX IF NOT EXISTS loans_issued_idx ON loans (issued_at)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS fines (
      id          SERIAL PRIMARY KEY,
      loan_id     INTEGER NOT NULL UNIQUE REFERENCES loans(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL,
      amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
      status      VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','waived')),
      payment_ref VARCHAR(40),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at     TIMESTAMPTZ
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS fines_user_idx ON fines (user_id, status)');
}

const app = createApp();

// Notifications are "fire and forget": a slow or failed email must never block a loan.
function notify(loan, type, subject, message) {
  callService('notification', '/internal/notify', {
    method: 'POST',
    body: { userId: loan.user_id, email: loan.user_email, name: loan.user_name, type, subject, message },
  }).catch((err) => logger.warn('notify_failed', { type, loanId: loan.id, error: err.message }));
}

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

function publicLoan(l) {
  const overdueDays = l.returned_at ? rules.daysOverdue(l.due_at, l.returned_at) : rules.daysOverdue(l.due_at);
  return {
    id: l.id,
    userId: l.user_id,
    userName: l.user_name,
    userEmail: l.user_email,
    bookId: l.book_id,
    bookTitle: l.book_title,
    bookAuthor: l.book_author,
    issuedAt: l.issued_at,
    dueAt: l.due_at,
    returnedAt: l.returned_at,
    status: l.status,
    renewals: l.renewals,
    overdueDays,
    fineAmount: l.fine_amount === undefined || l.fine_amount === null ? null : Number(l.fine_amount),
    fineStatus: l.fine_status || null,
  };
}

function publicFine(f) {
  return {
    id: f.id,
    loanId: f.loan_id,
    userId: f.user_id,
    amount: Number(f.amount),
    status: f.status,
    paymentRef: f.payment_ref,
    createdAt: f.created_at,
    paidAt: f.paid_at,
    bookTitle: f.book_title,
    userName: f.user_name,
    dueAt: f.due_at,
    returnedAt: f.returned_at,
  };
}

const LOAN_SELECT = `SELECT l.*, f.amount AS fine_amount, f.status AS fine_status FROM loans l LEFT JOIN fines f ON f.loan_id = l.id`;

async function unpaidTotal(userId) {
  const { rows } = await db.query(`SELECT coalesce(sum(amount),0)::float AS t FROM fines WHERE user_id=$1 AND status='unpaid'`, [userId]);
  return rows[0].t;
}

// ---- Borrow (issue) a book ----
// Members borrow for themselves; librarians can issue to any member at the desk.
app.post('/loans', requireAuth, asyncHandler(async (req, res) => {
  const bookId = v.int(req.body.bookId, 'bookId', { required: true, min: 1 });
  const userId = req.user.role === 'librarian'
    ? v.int(req.body.userId, 'userId', { required: true, min: 1 })
    : req.user.id;

  const user = await callService('auth', `/internal/users/${userId}`);
  const { rows: open } = await db.query(
    `SELECT book_id FROM loans WHERE user_id = $1 AND returned_at IS NULL`, [userId]);
  const reason = rules.borrowBlockReason({
    userStatus: user.status,
    activeLoans: open.length,
    unpaidFines: await unpaidTotal(userId),
    alreadyHasBook: open.some((l) => l.book_id === bookId),
  });
  if (reason) throw new HttpError(409, reason);

  // Step 1: reserve a copy in catalog-service (atomic). Step 2: create the loan.
  // If step 2 fails, undo step 1 (a simple "saga" across two microservices).
  const book = await callService('catalog', `/internal/books/${bookId}/checkout`, { method: 'POST' });
  let loan;
  try {
    const { rows } = await db.query(
      `INSERT INTO loans (user_id, book_id, user_name, user_email, book_title, book_author, due_at, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, bookId, user.name, user.email, book.title, book.author, rules.dueDate(), req.user.id],
    );
    loan = rows[0];
  } catch (err) {
    await callService('catalog', `/internal/books/${bookId}/checkout-undo`, { method: 'POST' }).catch(() => {});
    throw err;
  }
  metric('BooksIssued');
  logger.info('book_issued', { loanId: loan.id, userId, bookId, by: req.user.id });
  notify(loan, 'issued', `Book issued: ${book.title}`,
    `Hi ${user.name}, you have borrowed "${book.title}" by ${book.author}. Please return it by ${fmtDate(loan.due_at)}. Late returns are charged ₹${rules.config().finePerDay} per day.`);
  res.status(201).json(publicLoan(loan));
}));

// ---- Return a book (librarian desk) ----
app.post('/loans/:id/return', requireLibrarian, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const result = await db.withTransaction(async (c) => {
    const { rows } = await c.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [id]);
    const loan = rows[0];
    if (!loan) throw new HttpError(404, 'Loan not found');
    if (loan.returned_at) throw new HttpError(409, 'This book was already returned');
    const now = new Date();
    const fine = rules.fineFor(loan.due_at, now);
    const upd = await c.query(`UPDATE loans SET returned_at = $1, status = 'returned' WHERE id = $2 RETURNING *`, [now, id]);
    if (fine > 0) {
      await c.query(
        `INSERT INTO fines (loan_id, user_id, amount) VALUES ($1,$2,$3)
         ON CONFLICT (loan_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now() WHERE fines.status = 'unpaid'`,
        [id, loan.user_id, fine],
      );
    }
    return { loan: upd.rows[0], fine };
  });
  await callService('catalog', `/internal/books/${result.loan.book_id}/checkin`, { method: 'POST' })
    .catch((err) => logger.error('checkin_failed', { loanId: id, error: err.message }));
  metric('BooksReturned');
  if (result.fine > 0) metrics({ FinesCharged: { value: result.fine, unit: 'None' } });
  logger.info('book_returned', { loanId: id, fine: result.fine, by: req.user.id });
  notify(result.loan, 'returned', `Returned: ${result.loan.book_title}`,
    result.fine > 0
      ? `Thank you for returning "${result.loan.book_title}". It was ${rules.daysOverdue(result.loan.due_at, result.loan.returned_at)} day(s) late, so a fine of ₹${result.fine} has been added to your account.`
      : `Thank you for returning "${result.loan.book_title}" on time.`);
  const { rows } = await db.query(`${LOAN_SELECT} WHERE l.id = $1`, [id]);
  res.json(publicLoan(rows[0]));
}));

// ---- Renew (member, before the due date) ----
app.post('/loans/:id/renew', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const { rows } = await db.query('SELECT * FROM loans WHERE id = $1', [id]);
  const loan = rows[0];
  if (!loan || (loan.user_id !== req.user.id && req.user.role !== 'librarian')) throw new HttpError(404, 'Loan not found');
  const reason = rules.renewBlockReason(loan);
  if (reason) throw new HttpError(409, reason);
  const newDue = rules.dueDate(new Date(loan.due_at));
  const upd = await db.query(
    `UPDATE loans SET due_at = $1, renewals = renewals + 1, reminder_sent = false WHERE id = $2 AND returned_at IS NULL RETURNING *`,
    [newDue, id],
  );
  metric('LoansRenewed');
  notify(upd.rows[0], 'renewed', `Renewed: ${loan.book_title}`, `"${loan.book_title}" is now due on ${fmtDate(newDue)}.`);
  res.json(publicLoan(upd.rows[0]));
}));

app.get('/loans/me', requireAuth, asyncHandler(async (req, res) => {
  const open = req.query.status === 'history' ? 'l.returned_at IS NOT NULL' : 'l.returned_at IS NULL';
  const { rows } = await db.query(
    `${LOAN_SELECT} WHERE l.user_id = $1 AND ${open} ORDER BY l.due_at ASC, l.id DESC LIMIT 100`, [req.user.id]);
  res.json(rows.map(publicLoan));
}));

app.get('/loans', requireLibrarian, asyncHandler(async (req, res) => {
  const { page, limit, offset } = v.pagination(req.query, { defaultLimit: 25, maxLimit: 100 });
  const where = [];
  const params = [];
  const status = req.query.status;
  if (status === 'active') where.push('l.returned_at IS NULL');
  else if (status === 'overdue') where.push('l.returned_at IS NULL AND l.due_at < now()');
  else if (status === 'returned') where.push('l.returned_at IS NOT NULL');
  const userId = v.int(req.query.userId, 'userId', { min: 1 });
  if (userId) { params.push(userId); where.push(`l.user_id = $${params.length}`); }
  const q = v.str(req.query, 'q', { max: 100 });
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(l.book_title) LIKE $${params.length} OR lower(l.user_name) LIKE $${params.length} OR l.user_email LIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*)::int AS n FROM loans l ${w}`, params)).rows[0].n;
  const { rows } = await db.query(
    `${LOAN_SELECT} ${w} ORDER BY (l.returned_at IS NULL) DESC, l.due_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  res.json({ items: rows.map(publicLoan), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// ---- Fines ----
const FINE_SELECT = `SELECT f.*, l.book_title, l.user_name, l.due_at, l.returned_at FROM fines f JOIN loans l ON l.id = f.loan_id`;

app.get('/fines/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await db.query(`${FINE_SELECT} WHERE f.user_id = $1 ORDER BY (f.status='unpaid') DESC, f.created_at DESC LIMIT 100`, [req.user.id]);
  res.json({ items: rows.map(publicFine), unpaidTotal: await unpaidTotal(req.user.id), currency: rules.config().currency });
}));

app.get('/fines', requireLibrarian, asyncHandler(async (req, res) => {
  const status = ['unpaid', 'paid', 'waived'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await db.query(
    `${FINE_SELECT} ${status ? 'WHERE f.status = $1' : ''} ORDER BY f.updated_at DESC LIMIT 200`, status ? [status] : []);
  res.json(rows.map(publicFine));
}));

// Simulated online payment (a real system would call a payment gateway here).
app.post('/fines/:id/pay', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const ref = `PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const ownerClause = req.user.role === 'librarian' ? '' : 'AND user_id = $3';
  const params = req.user.role === 'librarian' ? [ref, id] : [ref, id, req.user.id];
  const { rows } = await db.query(
    `UPDATE fines SET status='paid', paid_at=now(), payment_ref=$1, updated_at=now()
     WHERE id=$2 AND status='unpaid' ${ownerClause} RETURNING *`, params);
  if (!rows[0]) throw new HttpError(404, 'No unpaid fine found');
  metrics({ FinesCollected: { value: Number(rows[0].amount), unit: 'None' } });
  logger.info('fine_paid', { fineId: id, amount: Number(rows[0].amount), by: req.user.id });
  res.json(publicFine(rows[0]));
}));

app.post('/fines/:id/waive', requireLibrarian, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const { rows } = await db.query(
    `UPDATE fines SET status='waived', updated_at=now() WHERE id=$1 AND status='unpaid' RETURNING *`, [id]);
  if (!rows[0]) throw new HttpError(404, 'No unpaid fine found');
  logger.info('fine_waived', { fineId: id, by: req.user.id });
  res.json(publicFine(rows[0]));
}));

// ---- Dashboard statistics ----
app.get('/stats', requireLibrarian, asyncHandler(async (_req, res) => {
  const [totals, daily, top, fines] = await Promise.all([
    db.query(`SELECT
        count(*) FILTER (WHERE returned_at IS NULL)::int AS active_loans,
        count(*) FILTER (WHERE returned_at IS NULL AND due_at < now())::int AS overdue_loans,
        count(*) FILTER (WHERE issued_at > now() - interval '1 day')::int AS issued_24h,
        count(*) FILTER (WHERE returned_at > now() - interval '1 day')::int AS returned_24h,
        count(*)::int AS all_time_loans
      FROM loans`),
    db.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM loans WHERE issued_at >= d AND issued_at < d + interval '1 day')::int AS issued,
        (SELECT count(*) FROM loans WHERE returned_at >= d AND returned_at < d + interval '1 day')::int AS returned
      FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
      ORDER BY d`),
    db.query(`SELECT book_id, max(book_title) AS title, max(book_author) AS author, count(*)::int AS loans
      FROM loans WHERE issued_at > now() - interval '90 days' GROUP BY book_id ORDER BY loans DESC LIMIT 5`),
    db.query(`SELECT
        coalesce(sum(amount) FILTER (WHERE status='unpaid'),0)::float AS unpaid,
        coalesce(sum(amount) FILTER (WHERE status='paid'),0)::float AS collected,
        count(*) FILTER (WHERE status='unpaid')::int AS unpaid_count
      FROM fines`),
  ]);
  res.json({ ...totals.rows[0], daily: daily.rows, topBooks: top.rows, fines: fines.rows[0], rules: rules.config() });
}));

app.get('/rules', (_req, res) => res.json(rules.config()));

// ---- Internal: nightly overdue job (called by AWS Lambda via EventBridge schedule) ----
const internal = express.Router();
internal.use(requireInternalKey);

internal.post('/overdue-run', asyncHandler(async (_req, res) => {
  const cfg = rules.config();
  const started = Date.now();

  // 1. Mark loans that just became overdue (these members get an overdue email).
  const newlyOverdue = await db.query(
    `UPDATE loans SET status = 'overdue' WHERE returned_at IS NULL AND due_at < now() AND status = 'active' RETURNING *`);

  // 2. Recalculate the fine of every overdue loan (₹ per day late, capped).
  const fines = await db.query(
    `INSERT INTO fines (loan_id, user_id, amount)
       SELECT id, user_id, LEAST(CEIL(EXTRACT(EPOCH FROM (now() - due_at)) / 86400) * $1, $2)
       FROM loans WHERE returned_at IS NULL AND due_at < now()
     ON CONFLICT (loan_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
       WHERE fines.status = 'unpaid'
     RETURNING loan_id, amount`, [cfg.finePerDay, cfg.maxFine]);
  const fineByLoan = new Map(fines.rows.map((f) => [f.loan_id, Number(f.amount)]));

  // 3. Remind members whose books are due within the next 24 hours.
  const dueSoon = await db.query(
    `UPDATE loans SET reminder_sent = true
     WHERE returned_at IS NULL AND reminder_sent = false AND due_at BETWEEN now() AND now() + interval '1 day'
     RETURNING *`);

  for (const l of newlyOverdue.rows) {
    notify(l, 'overdue', `Overdue: ${l.book_title}`,
      `Hi ${l.user_name}, "${l.book_title}" was due on ${fmtDate(l.due_at)}. Your current fine is ₹${fineByLoan.get(l.id) || 0} and grows by ₹${cfg.finePerDay} per day. Please return it soon.`);
  }
  for (const l of dueSoon.rows) {
    notify(l, 'due_soon', `Due tomorrow: ${l.book_title}`,
      `Hi ${l.user_name}, a reminder that "${l.book_title}" is due on ${fmtDate(l.due_at)}. You can renew it once from My Loans.`);
  }

  const totalOverdue = (await db.query(`SELECT count(*)::int AS n FROM loans WHERE returned_at IS NULL AND due_at < now()`)).rows[0].n;
  const summary = {
    newlyOverdue: newlyOverdue.rowCount,
    finesUpdated: fines.rowCount,
    remindersSent: dueSoon.rowCount,
    totalOverdue,
    durationMs: Date.now() - started,
    ranAt: new Date().toISOString(),
  };
  metrics({ OverdueLoans: { value: totalOverdue }, RemindersSent: { value: dueSoon.rowCount } });
  logger.info('overdue_job_completed', summary);
  res.json(summary);
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
