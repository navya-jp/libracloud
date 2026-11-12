import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import BookCover from '../components/BookCover.jsx';
import { Availability, Empty, ErrorBox, Pager, SearchIcon, Spinner, useAsync, useDebounced } from '../components/ui.jsx';

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') || '');
  const q = useDebounced(text, 300);
  const genre = params.get('genre') || '';
  const sort = params.get('sort') || 'title';
  const available = params.get('available') === 'true';
  const page = Number(params.get('page') || 1);

  const update = (patch) => {
    const next = Object.fromEntries(params.entries());
    Object.entries({ ...patch, page: patch.page || 1 }).forEach(([k, v]) => {
      if (v === '' || v === false || v === 1 || v === null) delete next[k]; else next[k] = String(v);
    });
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('q') || '') !== q) update({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const genres = useAsync(() => api.get('/catalog/genres'), []);
  const books = useAsync(
    () => api.get(`/catalog/books${qs({ q: params.get('q') || '', genre, sort, available, page, limit: 24 })}`),
    [params.toString()],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Catalogue</h1>
          <p>{books.data ? `${books.data.total.toLocaleString('en-IN')} titles` : 'Find your next book'}</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          <SearchIcon />
          <input placeholder="Search by title, author or ISBN" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search books" />
        </div>
        <select value={sort} onChange={(e) => update({ sort: e.target.value })} style={{ width: 'auto' }} aria-label="Sort">
          <option value="title">Title A–Z</option>
          <option value="popular">Most borrowed</option>
          <option value="rating">Highest rated</option>
          <option value="newest">Newest</option>
          <option value="added">Recently added</option>
        </select>
        <label className="chip" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontWeight: 500 }}>
          <input type="checkbox" checked={available} onChange={(e) => update({ available: e.target.checked })} style={{ width: 'auto' }} />
          Available now
        </label>
      </div>

      {genres.data?.length > 0 && (
        <div className="chips">
          <button className={`chip ${!genre ? 'on' : ''}`} onClick={() => update({ genre: '' })}>All</button>
          {genres.data.map((g) => (
            <button key={g.genre} className={`chip ${genre === g.genre ? 'on' : ''}`} onClick={() => update({ genre: genre === g.genre ? '' : g.genre })}>
              {g.genre}<span className="n">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      <ErrorBox error={books.error} />
      {books.loading && !books.data ? <Spinner /> : books.data && (
        books.data.items.length === 0 ? (
          <Empty title="No books found">Try a different search or clear the filters.</Empty>
        ) : (
          <>
            <div className="book-grid" style={{ opacity: books.loading ? 0.6 : 1 }}>
              {books.data.items.map((b) => (
                <Link key={b.id} to={`/books/${b.id}`} className="book-card">
                  <BookCover book={b} />
                  <div className="t">{b.title}</div>
                  <div className="a">{b.author}</div>
                  <div className="avail"><Availability book={b} /></div>
                </Link>
              ))}
            </div>
            <Pager page={books.data.page} pages={books.data.pages} onPage={(p) => { update({ page: p }); window.scrollTo(0, 0); }} />
          </>
        )
      )}
    </>
  );
}
