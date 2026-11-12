const { HttpError } = require('../../shared/errors');

// Password policy: at least 8 characters with a letter and a number.
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (pw.length > 72) throw new HttpError(400, 'Password must be at most 72 characters');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new HttpError(400, 'Password must contain a letter and a number');
}

// Never send password hashes to clients.
function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

module.exports = { validatePassword, publicUser };
