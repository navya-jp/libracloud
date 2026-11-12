import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, date } from '../api.js';
import { useAuth } from '../auth.jsx';
import BookCover from '../components/BookCover.jsx';
import { Availability, ErrorBox, Spinner, useAction, useAsync } from '../components/ui.jsx';

export default function BookDetail() {
  const { id } = useParams();
  const { user, isLibrarian } = useAuth();
  const nav = useNavigate();
  const book = useAsync(() => api.get(`/catalog/books/${id}`), [id]);
  const rules = useAsync(() => api.get('/circulation/rules'), []);
  const [run, busy] = useAction();

  const borrow = async () => {
    const loan = await run(() => api.post('/circulation/loans', { bookId: Number(id) }), (l) => `Borrowed! Please return by ${date(l.dueAt)}.`);
    if (loan) book.reload();
  };
  const readEbook = async () => {
    const r = await run(() => api.get(`/catalog/books/${id}/ebook`));
    if (r) window.open(r.url, '_blank', 'noopener');
  };

  if (book.loading && !book.data) return <Spinner />;
  if (book.error) return <ErrorBox error={book.error} />;
  const b = book.data;

  return (
    <>
      <p><Link to="/">← Back to catalogue</Link></p>
      <div className="detail card" style={{ padding: 28 }}>
        <div className="cover-col"><BookCover book={b} large /></div>
        <div>
          {b.genre && <span className="badge blue">{b.genre}</span>}
          <h1 style={{ marginTop: 10, fontSize: 34 }}>{b.title}</h1>
          <p style={{ fontSize: 17, color: 'var(--ink-2)' }}>by {b.author}</p>
          {b.description && <p style={{ maxWidth: 620 }}>{b.description}</p>}
          <dl className="meta">
            <dt>Availability</dt><dd><Availability book={b} /></dd>
            {b.publishedYear !== null && <><dt>First published</dt><dd>{b.publishedYear < 0 ? `${-b.publishedYear} BCE` : b.publishedYear}</dd></>}
            {b.publisher && <><dt>Publisher</dt><dd>{b.publisher}</dd></>}
            {b.pages && <><dt>Pages</dt><dd>{b.pages}</dd></>}
            {b.isbn && <><dt>ISBN</dt><dd className="mono">{b.isbn}</dd></>}
            {b.avgRating && <><dt>Goodreads rating</dt><dd>★ {b.avgRating.toFixed(2)} <span className="muted">({b.ratingsCount.toLocaleString('en-IN')} ratings)</span></dd></>}
            <dt>Times borrowed</dt><dd>{b.timesBorrowed}</dd>
          </dl>
          <div className="row">
            {!user && <button className="btn" onClick={() => nav('/login', { state: { from: `/books/${id}` } })}>Log in to borrow</button>}
            {user && !isLibrarian && (
              <button className="btn" disabled={busy || b.availableCopies < 1} onClick={borrow}>
                {b.availableCopies < 1 ? 'No copies available' : busy ? 'Borrowing…' : 'Borrow this book'}
              </button>
            )}
            {user && b.hasEbook && <button className="btn secondary" onClick={readEbook}>Read e-book</button>}
            {isLibrarian && <Link className="btn secondary" to={`/admin/books?edit=${b.id}`}>Edit book</Link>}
            {isLibrarian && <Link className="btn secondary" to={`/admin/circulation?book=${b.id}`}>Issue to a member</Link>}
          </div>
          {rules.data && user && !isLibrarian && (
            <p className="small muted" style={{ marginTop: 14 }}>
              Loan period {rules.data.loanDays} days · up to {rules.data.maxActiveLoans} books at a time · late fee ₹{rules.data.finePerDay}/day
            </p>
          )}
        </div>
      </div>
    </>
  );
}
