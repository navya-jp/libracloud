process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'catalog-service';

const multer = require('multer');
const {
  createApp, finalize, start, express, db, v, logger, metric,
  HttpError, asyncHandler, requireAuth, requireLibrarian, requireInternalKey,
} = require('../../shared');
const storage = require('./storage');
const { migrate } = require('./schema');
const { buildSearch, adjustCopies, publicBook } = require('./books');

const app = createApp();

// Local development only: serve uploaded files from disk. On AWS, CloudFront serves
// covers directly from S3 and e-books use pre-signed S3 URLs.
if (!storage.usingS3()) {
  app.use('/files', express.static(storage.LOCAL_DIR, { maxAge: '1d', fallthrough: false }));
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function bookFields(body, { partial = false } = {}) {
  const req = !partial;
  return {
    title: v.str(body, 'title', { required: req, min: 1, max: 400 }),
    author: v.str(body, 'author', { required: req, min: 1, max: 400 }),
    isbn: v.str(body, 'isbn', { max: 20 }),
    genre: v.str(body, 'genre', { max: 80 }),
    publisher: v.str(body, 'publisher', { max: 200 }),
    published_year: v.int(body.publishedYear, 'publishedYear', { min: -3000, max: new Date().getFullYear() + 1 }),
    language: v.str(body, 'language', { max: 20 }),
    pages: v.int(body.pages, 'pages', { min: 1, max: 100000 }),
    description: v.str(body, 'description', { max: 5000 }),
    total_copies: v.int(body.totalCopies, 'totalCopies', { required: req, min: 0, max: 1000 }),
  };
}

async function getBook(id) {
  const { rows } = await db.query('SELECT * FROM books WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'Book not found');
  return rows[0];
}

// ---- Public: browse and search ----
app.get('/books', asyncHandler(async (req, res) => {
  const { page, limit, offset } = v.pagination(req.query, { defaultLimit: 24, maxLimit: 60 });
  const s = buildSearch({ ...req.query, q: v.str(req.query, 'q', { max: 100 }) });
  const total = (await db.query(`SELECT count(*)::int AS n FROM books ${s.where}`, s.params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT * FROM books ${s.where} ORDER BY ${s.sort} LIMIT $${s.params.length + 1} OFFSET $${s.params.length + 2}`,
    [...s.params, limit, offset],
  );
  if (req.query.q) metric('Searches');
  res.json({ items: rows.map((b) => publicBook(b)), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

app.get('/genres', asyncHandler(async (_req, res) => {
  const { rows } = await db.query(
    `SELECT genre, count(*)::int AS count FROM books WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC, genre LIMIT 40`,
  );
  res.json(rows);
}));

app.get('/books/:id', asyncHandler(async (req, res) => {
  const book = await getBook(v.int(req.params.id, 'id', { required: true, min: 1 }));
  res.json(publicBook(book));
}));

// Members get a 5-minute link to read the e-book.
app.get('/books/:id/ebook', requireAuth, asyncHandler(async (req, res) => {
  const book = await getBook(v.int(req.params.id, 'id', { required: true, min: 1 }));
  if (!book.ebook_key) throw new HttpError(404, 'No e-book available for this title');
  metric('EbookOpens');
  logger.info('ebook_opened', { bookId: book.id, userId: req.user.id });
  res.json({ url: await storage.privateUrl(book.ebook_key, `${book.title}.pdf`), expiresInSeconds: 300 });
}));

// ---- Librarian: manage books ----
app.post('/books', requireLibrarian, asyncHandler(async (req, res) => {
  const f = bookFields(req.body);
  try {
    const { rows } = await db.query(
      `INSERT INTO books (title, author, isbn, genre, publisher, published_year, language, pages, description, total_copies, available_copies)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [f.title, f.author, f.isbn, f.genre, f.publisher, f.published_year, f.language, f.pages, f.description, f.total_copies],
    );
    logger.info('book_created', { bookId: rows[0].id, by: req.user.id });
    res.status(201).json(publicBook(rows[0]));
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'A book with this ISBN already exists');
    throw err;
  }
}));

app.put('/books/:id', requireLibrarian, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const f = bookFields(req.body);
  const updated = await db.withTransaction(async (c) => {
    const { rows } = await c.query('SELECT * FROM books WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'Book not found');
    let copies;
    try {
      copies = adjustCopies(rows[0].total_copies, rows[0].available_copies, f.total_copies);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    const r = await c.query(
      `UPDATE books SET title=$1, author=$2, isbn=$3, genre=$4, publisher=$5, published_year=$6, language=$7,
         pages=$8, description=$9, total_copies=$10, available_copies=$11, updated_at=now()
       WHERE id=$12 RETURNING *`,
      [f.title, f.author, f.isbn, f.genre, f.publisher, f.published_year, f.language, f.pages, f.description, copies.total, copies.available, id],
    );
    return r.rows[0];
  });
  logger.info('book_updated', { bookId: id, by: req.user.id });
  res.json(publicBook(updated));
}));

app.delete('/books/:id', requireLibrarian, asyncHandler(async (req, res) => {
  const book = await getBook(v.int(req.params.id, 'id', { required: true, min: 1 }));
  if (book.available_copies < book.total_copies) throw new HttpError(409, 'This book has copies on loan and cannot be deleted');
  await db.query('DELETE FROM books WHERE id = $1', [book.id]);
  await storage.remove(book.cover_key);
  await storage.remove(book.ebook_key);
  logger.info('book_deleted', { bookId: book.id, by: req.user.id });
  res.json({ ok: true });
}));

app.post('/books/:id/cover', requireLibrarian, upload.single('file'), asyncHandler(async (req, res) => {
  const book = await getBook(v.int(req.params.id, 'id', { required: true, min: 1 }));
  if (!req.file) throw new HttpError(400, 'Choose an image file');
  const ext = IMAGE_TYPES[req.file.mimetype];
  if (!ext) throw new HttpError(400, 'Cover must be a JPEG, PNG or WebP image');
  if (req.file.size > 2 * 1024 * 1024) throw new HttpError(413, 'Cover image must be under 2 MB');
  const key = `covers/${book.id}-${Date.now()}.${ext}`;
  await storage.put(key, req.file.buffer, req.file.mimetype);
  const { rows } = await db.query(
    'UPDATE books SET cover_key=$1, cover_url=$2, updated_at=now() WHERE id=$3 RETURNING *',
    [key, storage.publicUrl(key), book.id],
  );
  await storage.remove(book.cover_key);
  res.json(publicBook(rows[0]));
}));

app.post('/books/:id/ebook', requireLibrarian, upload.single('file'), asyncHandler(async (req, res) => {
  const book = await getBook(v.int(req.params.id, 'id', { required: true, min: 1 }));
  if (!req.file) throw new HttpError(400, 'Choose a PDF file');
  if (req.file.mimetype !== 'application/pdf' || req.file.buffer.subarray(0, 4).toString() !== '%PDF') {
    throw new HttpError(400, 'E-book must be a PDF file');
  }
  const key = `ebooks/${book.id}-${Date.now()}.pdf`;
  await storage.put(key, req.file.buffer, 'application/pdf');
  const { rows } = await db.query('UPDATE books SET ebook_key=$1, updated_at=now() WHERE id=$2 RETURNING *', [key, book.id]);
  await storage.remove(book.ebook_key);
  res.json(publicBook(rows[0]));
}));

app.get('/stats', requireLibrarian, asyncHandler(async (_req, res) => {
  const { rows } = await db.query(`
    SELECT count(*)::int AS titles,
           coalesce(sum(total_copies),0)::int AS total_copies,
           coalesce(sum(available_copies),0)::int AS available_copies,
           count(DISTINCT genre)::int AS genres,
           count(*) FILTER (WHERE ebook_key IS NOT NULL)::int AS ebooks
    FROM books`);
  res.json(rows[0]);
}));

// ---- Internal: used by circulation-service ----
const internal = express.Router();
internal.use(requireInternalKey);

// Atomically take one copy off the shelf. Fails if none are available.
internal.post('/books/:id/checkout', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const { rows } = await db.query(
    `UPDATE books SET available_copies = available_copies - 1, times_borrowed = times_borrowed + 1, updated_at = now()
     WHERE id = $1 AND available_copies > 0 RETURNING *`,
    [id],
  );
  if (!rows[0]) {
    await getBook(id); // 404 if the book does not exist
    throw new HttpError(409, 'No copies of this book are available right now');
  }
  res.json(publicBook(rows[0]));
}));

// Put one copy back on the shelf.
internal.post('/books/:id/checkin', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  const { rows } = await db.query(
    `UPDATE books SET available_copies = LEAST(available_copies + 1, total_copies), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'Book not found');
  res.json(publicBook(rows[0]));
}));

// Undo a checkout (used if creating the loan record fails).
internal.post('/books/:id/checkout-undo', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id', { required: true, min: 1 });
  await db.query(
    `UPDATE books SET available_copies = LEAST(available_copies + 1, total_copies),
       times_borrowed = GREATEST(times_borrowed - 1, 0) WHERE id = $1`,
    [id],
  );
  res.json({ ok: true });
}));

internal.get('/books', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  if (!ids.length) return res.json([]);
  const { rows } = await db.query('SELECT * FROM books WHERE id = ANY($1::int[])', [ids]);
  res.json(rows.map((b) => publicBook(b)));
}));

app.use('/internal', internal);
finalize(app);

// On first start, load the built-in sample books so the catalog is never empty.
// The full Kaggle dataset is imported separately with scripts/import-books.js.
async function init() {
  await migrate();
  if (process.env.SEED_SAMPLE === 'false') return;
  const { rows } = await db.query('SELECT count(*)::int AS n FROM books');
  if (rows[0].n === 0) {
    const { importBooks } = require('./importer');
    const r = await importBooks(require('path').join(__dirname, '..', 'data', 'sample-books.csv'));
    logger.info('sample_books_seeded', { inserted: r.inserted });
  }
}

if (require.main === module) {
  start(app, { init }).catch((err) => {
    logger.error('startup_failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = app;
