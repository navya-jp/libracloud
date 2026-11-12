const fs = require('fs');
const { db, logger } = require('../../shared');
const { parseCsvObjects } = require('./csv');
const { detectFormat, mapRow } = require('./dataset');

const COLS = ['isbn', 'title', 'author', 'genre', 'publisher', 'published_year', 'language', 'pages',
  'description', 'avg_rating', 'ratings_count', 'total_copies', 'cover_url', 'source'];

async function readSource(src) {
  if (src.startsWith('s3://')) {
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const [, , bucket, ...key] = src.split('/');
    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key.join('/') }));
    return out.Body.transformToString('utf8');
  }
  return fs.promises.readFile(src, 'utf8');
}

async function importBooks(src, { limit = Infinity, remoteCovers = true } = {}) {
  const rows = parseCsvObjects(await readSource(src));
  const format = detectFormat(Object.keys(rows[0] || {}));
  if (!format) throw new Error('Unrecognised CSV format - see data/README.md for supported datasets');

  const books = rows
    .map((r) => mapRow(format, r, { remoteCovers }))
    .filter((b) => b.title && b.author)
    .slice(0, limit);

  let inserted = 0;
  for (let i = 0; i < books.length; i += 500) {
    const chunk = books.slice(i, i + 500);
    const values = [];
    const params = [];
    chunk.forEach((b) => {
      const ph = COLS.map((c) => {
        params.push(c === 'ratings_count' ? (b[c] ?? 0) : (b[c] ?? null));
        return `$${params.length}`;
      });
      // available_copies starts equal to total_copies
      params.push(b.total_copies);
      ph.push(`$${params.length}`);
      values.push(`(${ph.join(',')})`);
    });
    const r = await db.query(
      `INSERT INTO books (${COLS.join(',')}, available_copies) VALUES ${values.join(',')}
       ON CONFLICT (isbn) WHERE isbn IS NOT NULL DO NOTHING`, params);
    inserted += r.rowCount;
  }
  logger.info('dataset_imported', { source: src, format, rows: rows.length, valid: books.length, inserted });
  return { format, rows: rows.length, valid: books.length, inserted, skipped: books.length - inserted };
}

module.exports = { importBooks };
