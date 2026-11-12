import { useState } from 'react';
import { api, date, money } from '../../api.js';
import { Empty, Loadable, useAction, useAsync } from '../../components/ui.jsx';

export default function Fines() {
  const [status, setStatus] = useState('unpaid');
  const fines = useAsync(() => api.get(`/circulation/fines${status ? `?status=${status}` : ''}`), [status]);
  const [run, busy] = useAction();
  const act = async (f, action) => {
    const msg = action === 'pay' ? `Recorded payment of ${money(f.amount)}` : `Waived ${money(f.amount)}`;
    if (await run(() => api.post(`/circulation/fines/${f.id}/${action}`), msg)) fines.reload();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Fines</h1><p>Fines are recalculated every night by an AWS Lambda function.</p></div>
        <div className="chips" style={{ margin: 0 }}>
          {['unpaid', 'paid', 'waived', ''].map((s) => (
            <button key={s || 'all'} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s || 'all'}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <Loadable state={fines}>
          {(items) => items.length === 0 ? <Empty title="No fines here" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Member</th><th>Book</th><th>Due</th><th>Returned</th><th>Amount</th><th>Status</th><th /></tr></thead>
              <tbody>{items.map((f) => (
                <tr key={f.id}>
                  <td>{f.userName}</td>
                  <td className="title">{f.bookTitle}</td>
                  <td>{date(f.dueAt)}</td>
                  <td>{f.returnedAt ? date(f.returnedAt) : <span className="badge red">still out</span>}</td>
                  <td><strong>{money(f.amount)}</strong></td>
                  <td><span className={`badge ${f.status === 'unpaid' ? 'red' : f.status === 'paid' ? 'green' : ''}`}>{f.status}</span></td>
                  <td className="actions">{f.status === 'unpaid' && (
                    <>
                      <button className="btn sm" disabled={busy} onClick={() => act(f, 'pay')}>Mark paid</button>{' '}
                      <button className="btn secondary sm" disabled={busy} onClick={() => act(f, 'waive')}>Waive</button>
                    </>
                  )}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Loadable>
      </div>
    </>
  );
}
