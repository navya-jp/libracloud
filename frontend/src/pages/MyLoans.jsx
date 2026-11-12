import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, date, money, relDays } from '../api.js';
import { Empty, LoanBadge, Loadable, useAction, useAsync } from '../components/ui.jsx';

export default function MyLoans() {
  const [tab, setTab] = useState('current');
  const loans = useAsync(() => api.get(`/circulation/loans/me${tab === 'history' ? '?status=history' : ''}`), [tab]);
  const [run, busy] = useAction();

  const renew = async (l) => {
    if (await run(() => api.post(`/circulation/loans/${l.id}/renew`), (r) => `Renewed - now due ${date(r.dueAt)}`)) loans.reload();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>My loans</h1><p>Books you have borrowed. Return them at the library desk.</p></div>
        <div className="chips" style={{ margin: 0 }}>
          <button className={`chip ${tab === 'current' ? 'on' : ''}`} onClick={() => setTab('current')}>Current</button>
          <button className={`chip ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>History</button>
        </div>
      </div>
      <div className="card">
        <Loadable state={loans}>
          {(items) => items.length === 0 ? (
            <Empty title={tab === 'current' ? 'No books on loan' : 'No past loans yet'}>
              {tab === 'current' && <Link to="/">Browse the catalogue</Link>}
            </Empty>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>Book</th><th>Borrowed</th><th>{tab === 'current' ? 'Due' : 'Returned'}</th><th>Status</th><th>Fine</th><th /></tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id}>
                    <td><Link className="title" to={`/books/${l.bookId}`}>{l.bookTitle}</Link><div className="small muted">{l.bookAuthor}</div></td>
                    <td className="nowrap">{date(l.issuedAt)}</td>
                    <td className="nowrap">{tab === 'current' ? <>{date(l.dueAt)}<div className="small muted">{relDays(l.dueAt)}</div></> : date(l.returnedAt)}</td>
                    <td><LoanBadge loan={l} />{l.renewals > 0 && <span className="small muted"> · renewed</span>}</td>
                    <td>{l.fineAmount ? <span className={l.fineStatus === 'unpaid' ? 'badge red' : 'badge'}>{money(l.fineAmount)} {l.fineStatus}</span> : '—'}</td>
                    <td className="actions">
                      {tab === 'current' && l.overdueDays === 0 && (
                        <button className="btn secondary sm" disabled={busy} onClick={() => renew(l)}>Renew</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Loadable>
      </div>
    </>
  );
}
