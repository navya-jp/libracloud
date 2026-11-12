#!/usr/bin/env node
// Import a book dataset into the catalog.
//
// Usage (inside the catalog container):
//   node scripts/import-books.js /data/books.csv
//   node scripts/import-books.js s3://<your-bucket>/datasets/books.csv
//   node scripts/import-books.js /data/books.csv --limit 2000 --no-remote-covers
//
// Supported: Kaggle goodbooks-10k, Kaggle Goodreads books, or data/sample-books.csv.

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'catalog-importer';
const { db } = require('../../shared');
const { migrate } = require('../src/schema');
const { importBooks } = require('../src/importer');

async function main() {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith('--'));
  if (!src) {
    console.error('Usage: node scripts/import-books.js <file.csv | s3://bucket/key> [--limit N] [--no-remote-covers]');
    process.exit(2);
  }
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
  await db.waitForDb(5, 1000);
  await migrate();
  const r = await importBooks(src, { limit, remoteCovers: !args.includes('--no-remote-covers') });
  console.log(`Imported ${r.inserted} books (${r.format} format, ${r.rows} rows read, ${r.skipped} duplicates skipped).`);
  await db.pool.end();
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
