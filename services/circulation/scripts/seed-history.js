#!/usr/bin/env node
// Generates realistic library history (demo data) so the dashboard, CloudWatch
// business metrics and the monitoring analysis have something to show.
//
// Creates members and N days of past loans: most returned on time, some late
// (with fines, some paid), some still on loan, and a few currently overdue.
//
//   docker compose exec circulation node scripts/seed-history.js --members 40 --days 60
//
// Demo members can log in with password  Member@12345
// Run it ONCE on a fresh database (it refuses if seeded members already exist).

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'seed-history';
const { db } = require('../../shared');
const rules = require('../src/rules');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const MEMBERS = opt('members', 40);
const DAYS = opt('days', 60);
const PER_DAY = opt('per-day', 6);
const DAY = 86400000;
const PASSWORD_HASH = '$2a$10$V75JgDUYdJeWcTSr8Ne0bevEmWEp5T3CuHaOOt61eztrgpKK7B/3G'; // "Member@12345"

// Deterministic random numbers, so every run produces the same dataset.
let seed = opt('seed', 2026);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Isha', 'Kabir', 'Meera', 'Rohan', 'Sara', 'Aditya', 'Kavya',
  'Ishaan', 'Navya', 'Reyansh', 'Priya', 'Krishna', 'Tara', 'Aryan', 'Nisha', 'Dev', 'Pooja', 'Rahul', 'Sneha', 'Varun', 'Anjali'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Mehta', 'Rao', 'Singh', 'Desai', 'Kulkarni', 'Joshi', 'Shah', 'Menon', 'Bose'];

async function main() {
  await db.waitForDb(5, 1000);
  const existing = await db.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@demo.libracloud.local'`);
  if (existing.rows[0].n > 0) {
    console.log('Demo history already exists - nothing to do.');
    return db.pool.end();
  }

  const { rows: books } = await db.query('SELECT id, title, author, total_copies, available_copies, ratings_count FROM books ORDER BY id');
  if (books.length === 0) throw new Error('No books found - start catalog-service first so it loads the sample books.');
  // Popular books are borrowed more often.
  const weighted = books.flatMap((b) => Array(1 + Math.min(5, Math.floor(Math.log10((b.ratings_count || 0) + 1)) + between(0, 2))).fill(b));
  const shelf = new Map(books.map((b) => [b.id, b.available_copies]));

  // 1. Members
  const members = [];
  for (let i = 0; i < MEMBERS; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${i + 1}@demo.libracloud.local`;
    const joined = new Date(Date.now() - between(DAYS, DAYS + 120) * DAY);
    const r = await db.query(
      `INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1,$2,$3,'member',$4) RETURNING id, name, email`,
      [name, email, PASSWORD_HASH, joined]);
    members.push(r.rows[0]);
  }

  // 2. Loans, day by day
  const cfg = rules.config();
  let loans = 0; let open = 0; let fines = 0;
  for (let d = DAYS; d >= 0; d--) {
    const day = new Date(Date.now() - d * DAY);
    const weekend = [0, 6].includes(day.getDay());
    const count = Math.max(0, Math.round(PER_DAY * (weekend ? 1.5 : 1) * (0.5 + rand())));
    for (let k = 0; k < count; k++) {
      const m = pick(members);
      const b = pick(weighted);
      const issuedAt = new Date(day.getTime() + between(9, 19) * 3600000 + between(0, 59) * 60000);
      if (issuedAt > new Date()) continue;
      const dueAt = new Date(issuedAt.getTime() + cfg.loanDays * DAY);
      // Return behaviour: 70% on time, 18% late, rest not yet returned.
      const roll = rand();
      let returnedAt = null;
      if (roll < 0.70) returnedAt = new Date(issuedAt.getTime() + between(2, cfg.loanDays) * DAY);
      else if (roll < 0.88) returnedAt = new Date(dueAt.getTime() + between(1, 12) * DAY);
      if (returnedAt && returnedAt > new Date()) returnedAt = null;
      if (!returnedAt) {
        if ((shelf.get(b.id) || 0) < 1) continue; // no copy left on the shelf
        shelf.set(b.id, shelf.get(b.id) - 1);
      }
      const overdueNow = !returnedAt && dueAt < new Date();
      const status = returnedAt ? 'returned' : overdueNow ? 'overdue' : 'active';
      const r = await db.query(
        `INSERT INTO loans (user_id, book_id, user_name, user_email, book_title, book_author, issued_at, due_at, returned_at, status, reminder_sent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [m.id, b.id, m.name, m.email, b.title, b.author, issuedAt, dueAt, returnedAt, status, status !== 'active']);
      loans++;
      if (!returnedAt) open++;
      const fine = rules.fineFor(dueAt, returnedAt || new Date(), cfg);
      if (fine > 0) {
        const paid = returnedAt && rand() < 0.6;
        await db.query(
          `INSERT INTO fines (loan_id, user_id, amount, status, payment_ref, created_at, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [r.rows[0].id, m.id, fine, paid ? 'paid' : 'unpaid', paid ? `PAY-SEED${r.rows[0].id}` : null,
            returnedAt || new Date(), paid ? new Date(returnedAt.getTime() + between(0, 3) * DAY) : null]);
        fines++;
      }
      await db.query('UPDATE books SET times_borrowed = times_borrowed + 1 WHERE id = $1', [b.id]);
    }
  }

  // 3. Keep the catalogue's shelf counts consistent with open loans.
  for (const [id, available] of shelf) {
    await db.query('UPDATE books SET available_copies = $1 WHERE id = $2', [available, id]);
  }

  console.log(`Seeded ${members.length} members, ${loans} loans (${open} still out), ${fines} fines over ${DAYS} days.`);
  console.log('Demo members log in with password: Member@12345');
  console.log(`For the load test use: --members ${members.slice(0, 5).map((m) => m.email).join(',')}`);
  await db.pool.end();
}

main().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
