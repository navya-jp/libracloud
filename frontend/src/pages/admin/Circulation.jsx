import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, date, money, qs, relDays } from '../../api.js';
import { Empty, LoanBadge, Loadable, Pager, SearchIcon, useAction, useAsync, useDebounced } from '../../components/ui.jsx';

function Picker({ label, placeholder, search, render, value, onChange }) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 250);
  const results = useAsync(() => (q.length >= 2 ? search(q) : Promise.resolve([])), [q]);
  if (value) {
    return (
      <div className="field"><label>{label}</label>
        <div className="row" style={{ background: 'var(--green-soft)', borderRadius: 8, padding: '9px 12px' }}>
          <div className="grow">{render(value)}</div>
          <button className="btn secondary sm" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="field"><label>{label}</label>
      <div className="search"><SearchIcon /><input placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} /></div>
      {results.data?.length > 0 && (
        <div className="card" style={{ padding: 6, marginTop: 6 }}>
          {results.data.slice(0, 6).map((r) => (
            <button key={r.id} className="chip" style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6, padding: '8px 10px' }}
              onClick={() => { onChange(r); setText(''); }}>{render(r)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Circulation() {
  const [params, setParams] = useSearchParams();
  const [member, setMember] = useState(null);
  const [book, setBook] = useState(null);
  const [status, setStatus] = useState(params.get('status') || 'active');
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [run, busy] = useAction();

  useEffect(() => {
    const id = params.get('book');
    if (id) api.get(`/catalog/books/${id}`).then(setBook).catch(() => {});
  }, [params]);

  const loans = useAsync(() => api.get(`/circulation/loans${qs({ status, page, q })}`), [status, page, q]);

  const issue = async () => {
    const r = await run(() => api.post('/circulation/loans', { userId: member.id, bookId: book.id }),
      (l) => `Issued "${l.bookTitle}" to ${l.userName} - due ${date(l.dueAt)}`);
    if (r) { setBook(null); setMember(null); setParams({}, { replace: true }); loans.reload(); }
  };
  const ret = async (l) => {
    const r = await run(() => api.post(`/circulation/loans/${l.id}/return`),
      (x) => (x.fineAmount ? `Returned. Late by ${x.overdueDays} day(s): fine ${money(x.fineAmount)}` : 'Returned on time - no fine'));
    if (r) loans.reload();
  };

  return (
    <>
      <div className="page-head"><div><h1>Issue &amp; return</h1><p>The circulation desk.</p></div></div>
      <div className="card">
        <div className="card-head"><h3>Issue a book</h3></div>
        <div className="grid-2">
          <Picker label="Member" placeholder="Search name or email" value={member} onChange={setMember}
            search={(s) => api.get(`/auth/users${qs({ q: s, role: 'member', limit: 6 })}`).then((r) => r.items)}
            render={(m) => <><strong>{m.name}</strong> <span className="muted small">{m.email}</span> {m.status !== 'active' && <span className="badge red">suspended</span>}</>} />
          <Picker label="Book" placeholder="Search title or author" value={book} onChange={setBook}
            search={(s) => api.get(`/catalog/books${qs({ q: s, limit: 6 })}`).then((r) => r.items)}
            render={(b) => <><strong>{b.title}</strong> <span className="muted small">{b.author} · {b.availableCopies}/{b.totalCopies} available</span></>} />
        </div>
        <button className="btn" disabled={!member || !book || busy} onClick={issue}>Issue book</button>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Loans</h3>
          <div className="chips" style={{ margin: 0 }}>
            {['active', 'overdue', 'returned', ''].map((s) => (
              <button key={s || 'all'} className={`chip ${status === s ? 'on' : ''}`} onClick={() => { setStatus(s); setPage(1); }}>{s || 'all'}</button>
            ))}
          </div>
        </div>
        <div className="search" style={{ marginBottom: 12 }}><SearchIcon /><input placeholder="Filter by book or member" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} /></div>
        <Loadable state={loans}>
          {(d) => d.items.length === 0 ? <Empty title="No loans match" /> : (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Book</th><th>Member</th><th>Issued</th><th>Due</th><th>Status</th><th>Fine</th><th /></tr></thead>
                <tbody>{d.items.map((l) => (
                  <tr key={l.id}>
                    <td className="title">{l.bookTitle}</td>
                    <td>{l.userName}<div className="small muted">{l.userEmail}</div></td>
                    <td className="nowrap">{date(l.issuedAt)}</td>
                    <td className="nowrap">{date(l.dueAt)}{!l.returnedAt && <div className="small muted">{relDays(l.dueAt)}</div>}</td>
                    <td><LoanBadge loan={l} /></td>
                    <td>{l.fineAmount ? money(l.fineAmount) : '—'}</td>
                    <td className="actions">{!l.returnedAt && <button className="btn sm" disabled={busy} onClick={() => ret(l)}>Return</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager page={d.page} pages={d.pages} onPage={setPage} />
            </>
          )}
        </Loadable>
      </div>
    </>
  );
}
