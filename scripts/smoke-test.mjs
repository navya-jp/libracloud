#!/usr/bin/env node
// End-to-end smoke test: walks through a full library flow against a running system.
// Used by the CI/CD pipeline and after every deployment.
//
//   node scripts/smoke-test.mjs                         # local docker compose (http://localhost:8080)
//   BASE_URL=https://xxxx.execute-api.us-east-1.amazonaws.com node scripts/smoke-test.mjs   # deployed site
//
// Env: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, INTERNAL_API_KEY (optional, tests the overdue job)

const BASE = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const API = {
  auth: process.env.AUTH_API || `${BASE}/api/auth`,
  catalog: process.env.CATALOG_API || `${BASE}/api/catalog`,
  circulation: process.env.CIRCULATION_API || `${BASE}/api/circulation`,
  notifications: process.env.NOTIFICATION_API || `${BASE}/api/notifications`,
};
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@libracloud.local', password: process.env.ADMIN_PASSWORD || 'Admin@12345' };

let passed = 0;
async function call(method, url, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${url} -> ${res.status} (expected ${expect.join('/')}): ${text.slice(0, 300)}`);
  }
  return data;
}
function ok(name) { passed++; console.log(`  ✔ ${name}`); }

async function main() {
  console.log(`Smoke test against ${BASE}`);
  for (const [name, url] of Object.entries(API)) {
    const h = await call('GET', `${url}/health`);
    if (h.status !== 'ok') throw new Error(`${name} unhealthy`);
    ok(`${name} healthy (version ${h.version})`);
  }

  const admin = await call('POST', `${API.auth}/login`, { body: ADMIN });
  ok('librarian can log in');
  await call('POST', `${API.auth}/login`, { body: { email: ADMIN.email, password: 'wrong-pass1' }, expect: [401] });
  ok('wrong password rejected');
  await call('GET', `${API.catalog}/stats`, { expect: [401] });
  ok('protected endpoint requires login');

  const email = `smoke.${Date.now()}@example.com`;
  const member = await call('POST', `${API.auth}/register`, { body: { name: 'Smoke Tester', email, password: 'Smoke12345' } });
  ok('member can sign up');
  await call('GET', `${API.catalog}/stats`, { token: member.token, expect: [403] });
  ok('member cannot use librarian endpoints');

  const book = await call('POST', `${API.catalog}/books`, {
    token: admin.token,
    body: { title: `Smoke Test Book ${Date.now()}`, author: 'CI Pipeline', genre: 'Testing', totalCopies: 1 },
  });
  ok('librarian can add a book');
  const search = await call('GET', `${API.catalog}/books?q=${encodeURIComponent(book.title)}`);
  if (search.total < 1) throw new Error('new book not found in search');
  ok('search finds the book');

  const loan = await call('POST', `${API.circulation}/loans`, { token: member.token, body: { bookId: book.id } });
  ok(`member borrowed the book (due ${loan.dueAt.slice(0, 10)})`);
  const after = await call('GET', `${API.catalog}/books/${book.id}`);
  if (after.availableCopies !== 0) throw new Error('available copies not decremented');
  ok('available copies updated across services');
  await call('POST', `${API.circulation}/loans`, { token: member.token, body: { bookId: book.id }, expect: [409] });
  ok('cannot borrow a book with no copies left');

  await call('POST', `${API.circulation}/loans/${loan.id}/renew`, { token: member.token });
  ok('member renewed the loan');
  await call('POST', `${API.circulation}/loans/${loan.id}/return`, { token: admin.token });
  ok('librarian recorded the return');
  const back = await call('GET', `${API.catalog}/books/${book.id}`);
  if (back.availableCopies !== 1) throw new Error('copy not returned to shelf');
  ok('copy is back on the shelf');

  await new Promise((r) => setTimeout(r, 500));
  const notes = await call('GET', `${API.notifications}/me`, { token: member.token });
  if (notes.items.length < 2) throw new Error(`expected notifications, got ${notes.items.length}`);
  ok(`member received ${notes.items.length} notifications`);

  if (process.env.INTERNAL_API_KEY) {
    const r = await fetch(`${API.circulation}/internal/overdue-run`, { method: 'POST', headers: { 'x-internal-key': process.env.INTERNAL_API_KEY } });
    if (!r.ok) throw new Error(`overdue job failed: ${r.status}`);
    ok(`overdue job ran: ${await r.text()}`);
  }

  await call('DELETE', `${API.catalog}/books/${book.id}`, { token: admin.token });
  ok('cleanup');
  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((err) => {
  console.error(`\n✘ FAILED after ${passed} checks: ${err.message}`);
  process.exit(1);
});
