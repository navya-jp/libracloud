const test = require('node:test');
const assert = require('node:assert');
const { validatePassword, publicUser } = require('../src/users');

test('accepts a strong password', () => {
  assert.doesNotThrow(() => validatePassword('library2026'));
});

test('rejects short or weak passwords', () => {
  assert.throws(() => validatePassword('abc1'), /at least 8/);
  assert.throws(() => validatePassword('onlyletters'), /letter and a number/);
  assert.throws(() => validatePassword('12345678'), /letter and a number/);
  assert.throws(() => validatePassword(undefined), /at least 8/);
});

test('publicUser never exposes the password hash', () => {
  const u = publicUser({ id: 1, name: 'A', email: 'a@b.co', password_hash: 'secret', role: 'member', status: 'active' });
  assert.equal(u.password_hash, undefined);
  assert.equal(u.email, 'a@b.co');
});
