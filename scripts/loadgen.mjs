#!/usr/bin/env node
// LibraCloud load generator - creates realistic traffic for the monitoring analysis.
// No installation needed (Node.js 18+).
//
//   node scripts/loadgen.mjs --url https://dxxxx.cloudfront.net --users 20 --duration 300
//
// Each virtual user behaves like a library visitor: browses and searches the catalogue
// (most traffic), opens book pages, and sometimes logs in to view loans or borrow.
// While it runs, watch the CloudWatch dashboard. At the end it prints latency
// percentiles and writes two CSV files to ./loadtest-results/ for your report:
//   summary-<time>.csv     per-endpoint count, errors, p50/p95/p99
//   timeline-<time>.csv    per-second requests, errors and average latency

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BASE = String(arg('url', 'http://localhost:8080')).replace(/\/$/, '');
const USERS = Number(arg('users', 10));
const DURATION = Number(arg('duration', 120)) * 1000;
const RAMP = Number(arg('ramp', 15)) * 1000;
const THINK = Number(arg('think', 1000));
const PASSWORD = arg('password', 'Member@12345');

const WORDS = ['the', 'love', 'war', 'sherlock', 'time', 'island', 'world', 'tolstoy', 'dickens', 'austen', 'night', 'king', 'house', 'tagore', 'verne', 'history'];
const stats = new Map();
const timeline = new Map();
let stop = false;
const logins = new Map(); // email -> Promise<token>

function record(name, ms, ok, status) {
  const s = stats.get(name) || { n: 0, err: 0, c4: 0, lat: [] };
  s.n++; if (!ok) s.err++; if (status >= 400 && status < 500) s.c4++; s.lat.push(ms); stats.set(name, s);
  const sec = Math.floor(Date.now() / 1000);
  const t = timeline.get(sec) || { n: 0, err: 0, total: 0 };
  t.n++; if (!ok) t.err++; t.total += ms; timeline.set(sec, t);
}

async function hit(name, method, p, { token, body } = {}) {
  const t0 = performance.now();
  let ok = false; let data = null; let status = 0;
  try {
    const res = await fetch(BASE + p, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    status = res.status;
    ok = res.status < 500; // 4xx (e.g. "no copies left") is normal behaviour, not a failure
    try { data = JSON.parse(text); } catch { /* html */ }
  } catch { ok = false; }
  record(name, performance.now() - t0, ok, status);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function visitor(id, memberEmails) {
  await sleep((RAMP / USERS) * id);
  let token = null;
  const email = memberEmails.length ? memberEmails[id % memberEmails.length] : null;
  while (!stop) {
    const roll = Math.random();
    if (roll < 0.10) await hit('GET /', 'GET', '/');
    const list = await hit('GET /books (search)', 'GET', `/api/catalog/books?q=${rnd(WORDS)}&limit=24`);
    if (roll < 0.5) await hit('GET /genres', 'GET', '/api/catalog/genres');
    const page = await hit('GET /books (browse)', 'GET', `/api/catalog/books?sort=${rnd(['title', 'popular', 'rating'])}&page=${1 + Math.floor(Math.random() * 3)}`);
    const items = (list?.items?.length ? list.items : page?.items) || [];
    const book = items.length ? rnd(items) : null;
    if (book) await hit('GET /books/:id', 'GET', `/api/catalog/books/${book.id}`);

    if (email && roll > 0.7) {
      // Log in once per member account and share the token (the auth service rate-limits
      // logins to 10 per 15 minutes per IP address, and a load test comes from one IP).
      if (!token) {
        if (!logins.has(email)) {
          logins.set(email, hit('POST /login', 'POST', '/api/auth/login', { body: { email, password: PASSWORD } }).then((r) => r?.token || null));
        }
        token = await logins.get(email);
      }
      if (token) {
        await hit('GET /loans/me', 'GET', '/api/circulation/loans/me', { token });
        await hit('GET /notifications/me', 'GET', '/api/notifications/me/unread-count', { token });
        if (book && roll > 0.95) await hit('POST /loans (borrow)', 'POST', '/api/circulation/loans', { token, body: { bookId: book.id } });
      }
    }
    await sleep(THINK * (0.5 + Math.random()));
  }
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function main() {
  console.log(`LibraCloud load test → ${BASE}\n${USERS} virtual users for ${DURATION / 1000}s (ramp-up ${RAMP / 1000}s)\n`);
  const emails = String(arg('members', '')).split(',').filter(Boolean);
  const started = Date.now();
  const progress = setInterval(() => {
    const total = [...stats.values()].reduce((a, s) => a + s.n, 0);
    const errs = [...stats.values()].reduce((a, s) => a + s.err, 0);
    process.stdout.write(`\r  ${Math.round((Date.now() - started) / 1000)}s  requests: ${total}  errors: ${errs}   `);
  }, 1000);
  setTimeout(() => { stop = true; }, DURATION);
  await Promise.all(Array.from({ length: USERS }, (_, i) => visitor(i, emails)));
  clearInterval(progress);

  const secs = (Date.now() - started) / 1000;
  const rows = [...stats.entries()].map(([name, s]) => ({
    name, n: s.n, err: s.err, c4: s.c4, p50: pct(s.lat, 50), p95: pct(s.lat, 95), p99: pct(s.lat, 99),
  }));
  const all = [...stats.values()].flatMap((s) => s.lat);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const errors = rows.reduce((a, r) => a + r.err, 0);

  console.log(`\n\n${'Endpoint'.padEnd(26)}${'Requests'.padStart(9)}${'Errors'.padStart(8)}${'4xx'.padStart(6)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}`);
  for (const r of rows) console.log(`${r.name.padEnd(26)}${String(r.n).padStart(9)}${String(r.err).padStart(8)}${String(r.c4).padStart(6)}${r.p50.toFixed(0).padStart(9)}${r.p95.toFixed(0).padStart(9)}${r.p99.toFixed(0).padStart(9)}`);
  console.log(`\nTotal ${total} requests in ${secs.toFixed(0)}s = ${(total / secs).toFixed(1)} req/s · error rate ${((errors / Math.max(1, total)) * 100).toFixed(2)}% · p95 ${pct(all, 95).toFixed(0)} ms`);

  const dir = path.resolve('loadtest-results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(dir, `summary-${stamp}.csv`),
    ['endpoint,requests,errors_5xx,client_4xx,p50_ms,p95_ms,p99_ms', ...rows.map((r) => `"${r.name}",${r.n},${r.err},${r.c4},${r.p50.toFixed(1)},${r.p95.toFixed(1)},${r.p99.toFixed(1)}`)].join('\n'));
  fs.writeFileSync(path.join(dir, `timeline-${stamp}.csv`),
    ['time,requests,errors,avg_latency_ms', ...[...timeline.entries()].sort().map(([s, t]) => `${new Date(s * 1000).toISOString()},${t.n},${t.err},${(t.total / t.n).toFixed(1)}`)].join('\n'));
  console.log(`Results saved to ${dir}`);
  const c4 = rows.reduce((a, r) => a + r.c4, 0);
  if (c4 > total * 0.5) console.log('\n⚠ Most requests returned 4xx - check the URL, the CloudFront origin header or the member password.');
}

main();
