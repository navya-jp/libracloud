// Pure helpers for the catalog (unit-tested, no database needed).

const SORTS = {
  title: 'lower(title) ASC, id ASC',
  newest: 'published_year DESC NULLS LAST, id DESC',
  rating: 'avg_rating DESC NULLS LAST, ratings_count DESC',
  popular: 'times_borrowed DESC, ratings_count DESC, id ASC',
  added: 'created_at DESC, id DESC',
};

function buildSearch(q) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\?/g, `$${params.length}`));
  };
  if (q.q) add('(lower(title) LIKE ? OR lower(author) LIKE ? OR isbn LIKE ?)', `%${String(q.q).toLowerCase().trim()}%`);
  if (q.genre) add('genre = ?', String(q.genre));
  if (q.author) add('lower(author) LIKE ?', `%${String(q.author).toLowerCase().trim()}%`);
  if (q.available === 'true') where.push('available_copies > 0');
  const sort = SORTS[q.sort] || SORTS.title;
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params, sort };
}

// When a librarian changes total copies, keep available copies consistent:
// copies currently on loan stay on loan.
function adjustCopies(oldTotal, oldAvailable, newTotal) {
  const onLoan = oldTotal - oldAvailable;
  if (newTotal < onLoan) {
    const err = new Error(`Cannot reduce copies below ${onLoan} - that many are currently on loan`);
    err.status = 400;
    throw err;
  }
  return { total: newTotal, available: newTotal - onLoan };
}

function publicBook(b, { coverUrl } = {}) {
  return {
    id: b.id,
    isbn: b.isbn,
    title: b.title,
    author: b.author,
    genre: b.genre,
    publisher: b.publisher,
    publishedYear: b.published_year,
    language: b.language,
    pages: b.pages,
    description: b.description,
    avgRating: b.avg_rating === null ? null : Number(b.avg_rating),
    ratingsCount: b.ratings_count,
    totalCopies: b.total_copies,
    availableCopies: b.available_copies,
    timesBorrowed: b.times_borrowed,
    coverUrl: coverUrl !== undefined ? coverUrl : b.cover_url,
    hasEbook: Boolean(b.ebook_key),
    createdAt: b.created_at,
  };
}

module.exports = { buildSearch, adjustCopies, publicBook, SORTS };
