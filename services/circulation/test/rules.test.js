const test = require('node:test');
const assert = require('node:assert');
const { daysOverdue, fineFor, borrowBlockReason, renewBlockReason, dueDate, DAY_MS } = require('../src/rules');

const cfg = { loanDays: 14, finePerDay: 5, maxFine: 500, maxActiveLoans: 3, maxUnpaidFines: 100, maxRenewals: 1 };
const due = new Date('2026-11-01T10:00:00Z');

test('no fine when returned on time', () => {
  assert.equal(daysOverdue(due, new Date('2026-11-01T09:00:00Z')), 0);
  assert.equal(fineFor(due, new Date('2026-11-01T10:00:00Z'), cfg), 0);
});

test('late returns are charged per started day', () => {
  assert.equal(daysOverdue(due, new Date('2026-11-01T10:01:00Z')), 1);
  assert.equal(fineFor(due, new Date('2026-11-04T10:00:00Z'), cfg), 15);
});

test('fine is capped', () => {
  assert.equal(fineFor(due, new Date('2027-06-01T00:00:00Z'), cfg), 500);
});

test('due date is loanDays ahead', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  assert.equal(dueDate(from, 14).getTime() - from.getTime(), 14 * DAY_MS);
});

test('borrowing rules', () => {
  const ok = { userStatus: 'active', activeLoans: 0, unpaidFines: 0, alreadyHasBook: false };
  assert.equal(borrowBlockReason(ok, cfg), null);
  assert.match(borrowBlockReason({ ...ok, userStatus: 'suspended' }, cfg), /suspended/);
  assert.match(borrowBlockReason({ ...ok, activeLoans: 3 }, cfg), /limit/);
  assert.match(borrowBlockReason({ ...ok, unpaidFines: 150 }, cfg), /fines/);
  assert.match(borrowBlockReason({ ...ok, alreadyHasBook: true }, cfg), /already/);
});

test('renewal rules', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  assert.equal(renewBlockReason({ due_at: due, renewals: 0 }, now, cfg), null);
  assert.match(renewBlockReason({ due_at: due, renewals: 1 }, now, cfg), /at most/);
  assert.match(renewBlockReason({ due_at: due, renewals: 0 }, new Date('2026-11-05T00:00:00Z'), cfg), /Overdue/);
});
