const { db } = require('../../shared');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS books (
      id               SERIAL PRIMARY KEY,
      isbn             VARCHAR(20),
      title            VARCHAR(400) NOT NULL,
      author           VARCHAR(400) NOT NULL,
      genre            VARCHAR(80),
      publisher        VARCHAR(200),
      published_year   INTEGER,
      language         VARCHAR(20),
      pages            INTEGER,
      description      TEXT,
      avg_rating       NUMERIC(3,2),
      ratings_count    INTEGER NOT NULL DEFAULT 0,
      total_copies     INTEGER NOT NULL DEFAULT 1 CHECK (total_copies >= 0),
      available_copies INTEGER NOT NULL DEFAULT 1 CHECK (available_copies >= 0),
      times_borrowed   INTEGER NOT NULL DEFAULT 0,
      cover_key        VARCHAR(300),
      cover_url        VARCHAR(600),
      ebook_key        VARCHAR(300),
      source           VARCHAR(40) NOT NULL DEFAULT 'manual',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT copies_not_exceed CHECK (available_copies <= total_copies)
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS books_title_idx ON books (lower(title))');
  await db.query('CREATE INDEX IF NOT EXISTS books_author_idx ON books (lower(author))');
  await db.query('CREATE INDEX IF NOT EXISTS books_genre_idx ON books (genre)');
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS books_isbn_uq ON books (isbn) WHERE isbn IS NOT NULL');
}

module.exports = { migrate };
