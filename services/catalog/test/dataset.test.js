const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, parseCsvObjects } = require('../src/csv');
const { detectFormat, mapRow, cleanIsbn, copiesFor } = require('../src/dataset');

test('CSV parser handles quotes, commas and newlines', () => {
  const rows = parseCsv('a,b,c\n"x, y","say ""hi""","multi\nline"\n');
  assert.deepEqual(rows[1], ['x, y', 'say "hi"', 'multi\nline']);
});

test('detects goodbooks-10k format and maps a row', () => {
  const csv = 'book_id,isbn,authors,original_publication_year,title,language_code,average_rating,ratings_count,image_url\n'
    + '1,439023483,Suzanne Collins,2008,The Hunger Games,eng,4.34,4780653,https://images.example/1.jpg\n';
  const [row] = parseCsvObjects(csv);
  const fmt = detectFormat(Object.keys(row));
  assert.equal(fmt, 'goodbooks-10k');
  const b = mapRow(fmt, row);
  assert.equal(b.isbn, '0439023483');
  assert.equal(b.published_year, 2008);
  assert.equal(b.total_copies, 5);
  assert.equal(b.cover_url, 'https://images.example/1.jpg');
});

test('detects Goodreads format (header with spaces) and joins authors', () => {
  const csv = 'bookID,title,authors,average_rating,isbn,isbn13,language_code,  num_pages,ratings_count,text_reviews_count,publication_date,publisher\n'
    + '1,Some Book,Author One/Author Two,4.1,0439785960,9780439785969,eng,652,2095690,27591,9/16/2006,Scholastic Inc.\n';
  const [row] = parseCsvObjects(csv);
  const fmt = detectFormat(Object.keys(row));
  assert.equal(fmt, 'goodreads');
  const b = mapRow(fmt, row);
  assert.equal(b.author, 'Author One, Author Two');
  assert.equal(b.pages, 652);
  assert.equal(b.published_year, 2006);
});

test('ISBN cleaning and copy counts', () => {
  assert.equal(cleanIsbn('978-0-14-143951-8'), '9780141439518');
  assert.equal(cleanIsbn('abc'), null);
  assert.equal(copiesFor(0), 1);
  assert.equal(copiesFor(50000000), 6);
});
