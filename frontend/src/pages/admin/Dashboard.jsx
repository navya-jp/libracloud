import { Link } from 'react-router-dom';
import { api, date, money } from '../../api.js';
import { ErrorBox, Spinner, useAsync } from '../../components/ui.jsx';

function Bars({ daily }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.issued, d.returned)));
  return (
    <>
      <div className="bars">
        {daily.map((d) => (
          <div className="col" key={d.day} title={`${d.day}: ${d.issued} issued, ${d.returned} returned`}>
            <div className="pair">
              <div className="b i" style={{ height: `${(d.issued / max) * 100}%` }} />
              <div className="b r" style={{ height: `${(d.returned / max) * 100}%` }} />
            </div>
            <div className="d">{d.day.slice(8)}</div>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        <span><i style={{ background: 'var(--green-2)' }} />Issued</span>
        <span><i style={{ background: 'var(--gold)' }} />Returned</span>
      </div>
    </>
  );
}

export default function Dashboard() {
  // Three microservices are queried in parallel; if one is down, the rest of the dashboard still works.
  const data = useAsync(async () => {
    const [circ, cat, users, overdue] = await Promise.allSettled([
      api.get('/circulation/stats'),
      api.get('/catalog/stats'),
      api.get('/auth/stats'),
      api.get('/circulation/loans?status=overdue&limit=6'),
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    return { circ: val(circ), cat: val(cat), users: val(users), overdue: val(overdue), failed: [circ, cat, users].filter((r) => r.status === 'rejected').length };
  }, []);

  if (data.loading && !data.data) return <Spinner />;
  if (data.error) return <ErrorBox error={data.error} />;
  const { circ, cat, users, overdue, failed } = data.data;

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>Library activity at a glance.</p></div>
        <div className="row">
          <Link className="btn" to="/admin/circulation">Issue or return a book</Link>
          <button className="btn secondary" onClick={data.reload}>Refresh</button>
        </div>
      </div>
      {failed > 0 && <div className="error-box">{failed} service(s) did not respond - some numbers are missing. Check <Link to="/status">System status</Link>.</div>}

      <div className="stats">
        <div className="stat"><div className="label">Books on loan</div><div className="value">{circ?.active_loans ?? '—'}</div><div className="hint">{circ ? `${circ.issued_24h} issued today` : ''}</div></div>
        <div className={`stat ${circ?.overdue_loans ? 'alert' : ''}`}><div className="label">Overdue</div><div className="value">{circ?.overdue_loans ?? '—'}</div><div className="hint">past due date</div></div>
        <div className="stat"><div className="label">Titles</div><div className="value">{cat?.titles?.toLocaleString('en-IN') ?? '—'}</div><div className="hint">{cat ? `${cat.available_copies} of ${cat.total_copies} copies on shelf` : ''}</div></div>
        <div className="stat"><div className="label">Members</div><div className="value">{users?.members ?? '—'}</div><div className="hint">{users ? `${users.new_members_30d} joined in 30 days` : ''}</div></div>
        <div className="stat"><div className="label">Fines unpaid</div><div className="value">{circ ? money(circ.fines.unpaid) : '—'}</div><div className="hint">{circ ? `${money(circ.fines.collected)} collected` : ''}</div></div>
      </div>

      <div className="grid-3-1">
        <div className="card">
          <div className="card-head"><h3>Last 14 days</h3></div>
          {circ ? <Bars daily={circ.daily} /> : <p className="muted">Circulation service unavailable.</p>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Most borrowed (90 days)</h3></div>
          {circ?.topBooks?.length ? (
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {circ.topBooks.map((b) => (
                <li key={b.book_id} style={{ marginBottom: 8 }}>
                  <Link to={`/books/${b.book_id}`}>{b.title}</Link>
                  <div className="small muted">{b.author} · {b.loans} loans</div>
                </li>
              ))}
            </ol>
          ) : <p className="muted">No loans yet.</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Overdue books</h3><Link to="/admin/circulation?status=overdue">View all</Link></div>
        {overdue?.items?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Book</th><th>Member</th><th>Due</th><th>Late</th><th>Fine</th></tr></thead>
            <tbody>{overdue.items.map((l) => (
              <tr key={l.id}>
                <td className="title">{l.bookTitle}</td>
                <td>{l.userName}<div className="small muted">{l.userEmail}</div></td>
                <td>{date(l.dueAt)}</td>
                <td><span className="badge red">{l.overdueDays} days</span></td>
                <td>{l.fineAmount ? money(l.fineAmount) : <span className="muted small">after nightly run</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">No overdue books. 🎉</p>}
      </div>
    </>
  );
}
