// Maps rows from public book datasets to LibraCloud books.
//
// Supported formats (detected from the CSV header):
//  1. "goodbooks-10k"  - Kaggle: zygmunt/goodbooks-10k  (books.csv, 10,000 books, has cover image URLs)
//  2. "goodreads"      - Kaggle: jealousleopard/goodreadsbooks (books.csv, ~11,000 books)
//  3. "libracloud"     - this project's own format (data/sample-books.csv)

function detectFormat(keys) {
  if (keys.includes('original_publication_year') && keys.includes('image_url')) return 'goodbooks-10k';
  if (keys.includes('bookid') && keys.includes('num_pages')) return 'goodreads';
  if (keys.includes('title') && keys.includes('author')) return 'libracloud';
  return null;
}

const intOrNull = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== '' ? n : null;
};
const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : null;
};

// ISBN-10 loses leading zeros in some exports (e.g. "439023483" -> "0439023483").
function cleanIsbn(v) {
  const s = String(v || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length === 9) return `0${s}`;
  if (s.length === 10 || s.length === 13) return s;
  return null;
}

// Popular books get more copies (1-6), so the library feels realistic.
function copiesFor(ratingsCount) {
  const r = Number(ratingsCount) || 0;
  return Math.max(1, Math.min(6, Math.floor(Math.log10(r + 1)) - 1));
}

function yearFromDate(s) {
  const m = String(s || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

const trim = (s, n) => (s ? String(s).slice(0, n) : null);

function mapRow(format, r, { remoteCovers = true } = {}) {
  if (format === 'goodbooks-10k') {
    const img = r.image_url && !r.image_url.includes('nophoto') ? r.image_url : null;
    return {
      isbn: cleanIsbn(r.isbn),
      title: trim(r.title || r.original_title, 400),
      author: trim(r.authors, 400),
      published_year: intOrNull(r.original_publication_year),
      language: trim(r.language_code, 20),
      avg_rating: numOrNull(r.average_rating),
      ratings_count: intOrNull(r.ratings_count) || 0,
      total_copies: copiesFor(r.ratings_count),
      cover_url: remoteCovers ? img : null,
      source: 'goodbooks-10k',
    };
  }
  if (format === 'goodreads') {
    const isbn = cleanIsbn(r.isbn);
    return {
      isbn,
      title: trim(r.title, 400),
      author: trim((r.authors || '').split('/').join(', '), 400),
      published_year: yearFromDate(r.publication_date),
      language: trim(r.language_code, 20),
      pages: intOrNull(r.num_pages) || null,
      publisher: trim(r.publisher, 200),
      avg_rating: numOrNull(r.average_rating),
      ratings_count: intOrNull(r.ratings_count) || 0,
      total_copies: copiesFor(r.ratings_count),
      cover_url: remoteCovers && isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : null,
      source: 'goodreads',
    };
  }
  return {
    isbn: cleanIsbn(r.isbn),
    title: trim(r.title, 400),
    author: trim(r.author, 400),
    genre: trim(r.genre, 80),
    published_year: intOrNull(r.published_year),
    language: trim(r.language, 20),
    pages: intOrNull(r.pages),
    description: trim(r.description, 5000),
    total_copies: intOrNull(r.total_copies) || 2,
    source: 'sample',
  };
}

module.exports = { detectFormat, mapRow, cleanIsbn, copiesFor };
