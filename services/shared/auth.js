// JWT authentication + role checks + service-to-service (internal) key check.
//
// The auth-service signs a JWT at login. Every other service verifies the token
// locally with the same secret (stateless - no call to auth-service per request).

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('./errors');
const { logger } = require('./logger');

let warned = false;
function secret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  if (!warned) {
    logger.warn('JWT_SECRET not set - using an insecure development secret');
    warned = true;
  }
  return 'dev-only-insecure-secret-change-me';
}

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: user.role, name: user.name, email: user.email },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'libracloud' },
  );
}

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Login required'));
  try {
    const p = jwt.verify(token, secret(), { issuer: 'libracloud' });
    req.user = { id: Number(p.sub), role: p.role, name: p.name, email: p.email };
    next();
  } catch {
    next(new HttpError(401, 'Session expired or invalid - please log in again'));
  }
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Login required'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission for this action'));
    next();
  };
}

const requireLibrarian = [requireAuth, requireRole('librarian')];

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Protects /internal/* endpoints that only other services (or the Lambda) may call.
function requireInternalKey(req, _res, next) {
  const expected = process.env.INTERNAL_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'dev-internal-key');
  if (!expected) return next(new HttpError(503, 'Internal API key not configured'));
  if (!safeEqual(req.headers['x-internal-key'] || '', expected)) return next(new HttpError(403, 'Forbidden'));
  next();
}

module.exports = { signToken, requireAuth, requireRole, requireLibrarian, requireInternalKey, safeEqual };
