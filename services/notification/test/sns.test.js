const test = require('node:test');
const assert = require('node:assert');
const { cleanSubject, formatEmail } = require('../src/sns');

test('SNS subject is ASCII, single-line and at most 100 characters', () => {
  const s = cleanSubject('Overdue: “Pride & Prejudice” ₹20\n' + 'x'.repeat(200));
  assert.ok(s.length <= 100);
  assert.ok(/^[\x20-\x7E]+$/.test(s));
  assert.ok(s.startsWith('[LibraCloud]'));
});

test('email body names the member', () => {
  const body = formatEmail({ name: 'Asha', email: 'asha@example.com', message: 'Hello', type: 'issued' });
  assert.match(body, /To: Asha <asha@example.com>/);
  assert.match(body, /Hello/);
});
