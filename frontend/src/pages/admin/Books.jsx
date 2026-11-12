import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import BookCover from '../../components/BookCover.jsx';
import { Availability, Empty, ErrorBox, Loadable, Modal, Pager, SearchIcon, useAction, useAsync, useDebounced } from '../../components/ui.jsx';

const BLANK = { title: '', author: '', isbn: '', genre: '', publisher: '', publishedYear: '', language: 'eng', pages: '', totalCopies: 1, description: '' };

function BookForm({ book, onClose, onSaved }) {
  const [f, setF] = useState(book ? { ...BLANK, ...Object.fromEntries(Object.entries(book).map(([k, v]) => [k, v ?? ''])) } : BLANK);
  const [error, setError] = useState(null);
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const body = { ...f, publishedYear: f.publishedYear === '' ? null : Number(f.publishedYear), pages: f.pages === '' ? null : Number(f.pages), totalCopies: Number(f.totalCopies) };
    try {
      const saved = book ? await api.put(`/catalog/books/${book.id}`, body) : await api.post('/catalog/books', body);
      onSaved(saved, book ? 'Book updated' : 'Book added');
    } catch (err) { setError(err); }
  };
  const upload = (kind) => async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = await run(() => api.upload(`/catalog/books/${book.id}/${kind}`, file), kind === 'cover' ? 'Cover uploaded to S3' : 'E-book uploaded to S3');
    if (r) onSaved(r, null, true);
    e.target.value = '';
  };

  return (
    <Modal title={book ? 'Edit book' : 'Add a book'} onClose={onClose} width={700}>
      <form onSubmit={save}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <div className="field full"><label>Title *</label><input required value={f.title} onChange={set('title')} /></div>
          <div className="field"><label>Author *</label><input required value={f.author} onChange={set('author')} /></div>
          <div className="field"><label>Genre</label><input value={f.genre} onChange={set('genre')} placeholder="e.g. Mystery" /></div>
          <div className="field"><label>ISBN</label><input value={f.isbn} onChange={set('isbn')} /></div>
          <div className="field"><label>Publisher</label><input value={f.publisher} onChange={set('publisher')} /></div>
          <div className="field"><label>Year published</label><input type="number" value={f.publishedYear} onChange={set('publishedYear')} /></div>
          <div className="field"><label>Pages</label><input type="number" min="1" value={f.pages} onChange={set('pages')} /></div>
          <div className="field"><label>Language</label><input value={f.language} onChange={set('language')} /></div>
          <div className="field"><label>Copies owned *</label><input type="number" min="0" required value={f.totalCopies} onChange={set('totalCopies')} /></div>
          <div className="field full"><label>Description</label><textarea rows="3" value={f.description} onChange={set('description')} /></div>
        </div>
        {book && (
          <div className="row" style={{ marginBottom: 12 }}>
            <label className="btn secondary sm" style={{ margin: 0, cursor: 'pointer' }}>
              Upload cover image<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload('cover')} disabled={busy} />
            </label>
            <label className="btn secondary sm" style={{ margin: 0, cursor: 'pointer' }}>
              {book.hasEbook ? 'Replace e-book (PDF)' : 'Upload e-book (PDF)'}<input type="file" accept="application/pdf" hidden onChange={upload('ebook')} disabled={busy} />
            </label>
            <span className="small muted">Files are stored in Amazon S3.</span>
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn">{book ? 'Save changes' : 'Add book'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Books() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // null | 'new' | book
  const books = useAsync(() => api.get(`/catalog/books${qs({ q, page, limit: 20, sort: 'added' })}`), [q, page]);
  const [run] = useAction();

  useEffect(() => {
    const id = params.get('edit');
    if (id) api.get(`/catalog/books/${id}`).then(setEditing).catch(() => {});
  }, [params]);

  const close = () => { setEditing(null); if (params.get('edit')) setParams({}, { replace: true }); };
  const saved = (b, msg, keepOpen) => {
    books.reload();
    if (keepOpen) setEditing(b);
    else { close(); if (msg) run(async () => b, msg); }
  };
  const remove = async (b) => {
    if (!window.confirm(`Delete "${b.title}"? This cannot be undone.`)) return;
    if (await run(() => api.del(`/catalog/books/${b.id}`), 'Book deleted')) books.reload();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Manage books</h1><p>Add titles, update copies, upload covers and e-books.</p></div>
        <button className="btn" onClick={() => setEditing('new')}>+ Add book</button>
      </div>
      <div className="card">
        <div className="search" style={{ marginBottom: 12 }}><SearchIcon /><input placeholder="Search books" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} /></div>
        <Loadable state={books}>
          {(d) => d.items.length === 0 ? <Empty title="No books" /> : (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th style={{ width: 48 }} /><th>Title</th><th>Genre</th><th>Copies</th><th>Borrowed</th><th /></tr></thead>
                <tbody>{d.items.map((b) => (
                  <tr key={b.id}>
                    <td><div style={{ width: 36 }}><BookCover book={b} thumb /></div></td>
                    <td><Link className="title" to={`/books/${b.id}`}>{b.title}</Link><div className="small muted">{b.author}{b.hasEbook ? ' · e-book' : ''}</div></td>
                    <td>{b.genre || <span className="muted">—</span>}</td>
                    <td><Availability book={b} /></td>
                    <td>{b.timesBorrowed}</td>
                    <td className="actions">
                      <button className="btn secondary sm" onClick={() => setEditing(b)}>Edit</button>{' '}
                      <button className="btn secondary sm" onClick={() => remove(b)}>Delete</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager page={d.page} pages={d.pages} onPage={setPage} />
            </>
          )}
        </Loadable>
      </div>
      {editing && <BookForm book={editing === 'new' ? null : editing} onClose={close} onSaved={saved} />}
    </>
  );
}
