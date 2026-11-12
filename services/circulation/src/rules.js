// Library rules - pure functions, unit-tested.
// All values can be changed with environment variables (no code change needed).

const DAY_MS = 24 * 60 * 60 * 1000;

const config = () => ({
  loanDays: Number(process.env.LOAN_DAYS || 14),
  finePerDay: Number(process.env.FINE_PER_DAY || 5), // rupees per day late
  maxFine: Number(process.env.MAX_FINE_PER_LOAN || 500), // cap per loan
  maxActiveLoans: Number(process.env.MAX_ACTIVE_LOANS || 3),
  maxUnpaidFines: Number(process.env.MAX_UNPAID_FINES || 100), // block borrowing above this
  maxRenewals: Number(process.env.MAX_RENEWALS || 1),
  currency: process.env.CURRENCY || 'INR',
});

function dueDate(from = new Date(), days = config().loanDays) {
  return new Date(from.getTime() + days * DAY_MS);
}

// Whole days late, rounded up (1 minute late = 1 day). 0 if not late.
function daysOverdue(dueAt, at = new Date()) {
  const diff = new Date(at).getTime() - new Date(dueAt).getTime();
  return diff > 0 ? Math.ceil(diff / DAY_MS) : 0;
}

function fineFor(dueAt, at = new Date(), cfg = config()) {
  return Math.min(daysOverdue(dueAt, at) * cfg.finePerDay, cfg.maxFine);
}

// Returns null if the member may borrow, otherwise the reason they cannot.
function borrowBlockReason({ userStatus, activeLoans, unpaidFines, alreadyHasBook }, cfg = config()) {
  if (userStatus !== 'active') return 'This account is suspended';
  if (alreadyHasBook) return 'You already have a copy of this book';
  if (activeLoans >= cfg.maxActiveLoans) return `Borrowing limit reached (${cfg.maxActiveLoans} books). Return a book first.`;
  if (unpaidFines > cfg.maxUnpaidFines) return `Unpaid fines of ₹${unpaidFines} - please pay before borrowing`;
  return null;
}

function renewBlockReason(loan, at = new Date(), cfg = config()) {
  if (loan.returned_at) return 'This book has already been returned';
  if (daysOverdue(loan.due_at, at) > 0) return 'Overdue books cannot be renewed - please return it';
  if (loan.renewals >= cfg.maxRenewals) return `A book can be renewed at most ${cfg.maxRenewals} time(s)`;
  return null;
}

module.exports = { config, dueDate, daysOverdue, fineFor, borrowBlockReason, renewBlockReason, DAY_MS };
