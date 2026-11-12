const test = require('node:test');
const assert = require('node:assert');
const { buildSearch, adjustCopies, publicBook } = require('../src/books');

test('search builds parameterised SQL (no SQL injection)', () => {
  const s = buildSearch({ q: "x'; DROP TABLE books; --", genre: 'Fiction', available: 'true' });
  assert.match(s.where, /\$1/);
  assert.match(s.where, /\$2/);
  assert.ok(!s.where.includes('DROP'));
  assert.equal(s.params.length, 2);
  assert.match(s.where, /available_copies > 0/);
});

test('unknown sort falls back to title', () => {
  assert.match(buildSearch({ sort: 'id; DROP' }).sort, /lower\(title\)/);
});

test('adjusting copies keeps loans intact', () => {
  assert.deepEqual(adjustCopies(5, 3, 8), { total: 8, available: 6 });
  assert.deepEqual(adjustCopies(5, 3, 2), { total: 2, available: 0 });
  assert.throws(() => adjustCopies(5, 3, 1), /currently on loan/);
});

test('publicBook hides storage keys', () => {
  const b = publicBook({ id: 1, title: 'T', author: 'A', avg_rating: '4.10', ebook_key: 'ebooks/1.pdf', cover_key: 'covers/1.jpg' });
  assert.equal(b.ebook_key, undefined);
  assert.equal(b.hasEbook, true);
  assert.equal(b.avgRating, 4.1);
});
