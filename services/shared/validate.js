// Small input-validation helpers (keeps dependencies minimal).
const { HttpError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(body, key, { required = false, min = 0, max = 500 } = {}) {
  const v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${key} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
  const t = v.trim();
  if (t.length < min) throw new HttpError(400, `${key} must be at least ${min} characters`);
  if (t.length > max) throw new HttpError(400, `${key} must be at most ${max} characters`);
  return t;
}

function int(value, key, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${key} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `${key} must be a whole number`);
  if (n < min || n > max) throw new HttpError(400, `${key} must be between ${min} and ${max}`);
  return n;
}

function num(value, key, { required = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${key} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${key} must be a number between ${min} and ${max}`);
  return n;
}

function email(body, key = 'email', opts = {}) {
  const v = str(body, key, { max: 254, ...opts });
  if (v && !EMAIL_RE.test(v)) throw new HttpError(400, 'Enter a valid email address');
  return v ? v.toLowerCase() : v;
}

function pagination(q, { defaultLimit = 20, maxLimit = 50 } = {}) {
  const page = Math.max(1, int(q.page, 'page', { min: 1 }) || 1);
  const limit = Math.min(maxLimit, int(q.limit, 'limit', { min: 1 }) || defaultLimit);
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { str, int, num, email, pagination, EMAIL_RE };
