import { useState } from 'react';
import { api, date, money } from '../api.js';
import { Empty, Loadable, Modal, useAction, useAsync } from '../components/ui.jsx';

export default function MyFines() {
  const fines = useAsync(() => api.get('/circulation/fines/me'), []);
  const [paying, setPaying] = useState(null);
  const [run, busy] = useAction();

  const pay = async () => {
    const r = await run(() => api.post(`/circulation/fines/${paying.id}/pay`), (f) => `Payment successful · reference ${f.paymentRef}`);
    if (r) { setPaying(null); fines.reload(); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Fines</h1><p>Late returns are charged per day. Unpaid fines over ₹100 block new loans.</p></div>
      </div>
      <Loadable state={fines}>
        {(d) => (
          <>
            <div className="stats">
              <div className={`stat ${d.unpaidTotal > 0 ? 'alert' : ''}`}><div className="label">Unpaid</div><div className="value">{money(d.unpaidTotal)}</div></div>
              <div className="stat"><div className="label">Fines on record</div><div className="value">{d.items.length}</div></div>
            </div>
            <div className="card">
              {d.items.length === 0 ? <Empty title="No fines">You have always returned books on time. 🎉</Empty> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Book</th><th>Due</th><th>Returned</th><th>Amount</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {d.items.map((f) => (
                      <tr key={f.id}>
                        <td className="title">{f.bookTitle}</td>
                        <td>{date(f.dueAt)}</td>
                        <td>{f.returnedAt ? date(f.returnedAt) : <span className="badge red">Not yet returned</span>}</td>
                        <td><strong>{money(f.amount)}</strong></td>
                        <td><span className={`badge ${f.status === 'unpaid' ? 'red' : f.status === 'paid' ? 'green' : ''}`}>{f.status}</span>
                          {f.paymentRef && <div className="small muted mono">{f.paymentRef}</div>}</td>
                        <td className="actions">{f.status === 'unpaid' && <button className="btn sm gold" onClick={() => setPaying(f)}>Pay now</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      </Loadable>
      {paying && (
        <Modal title="Pay fine" onClose={() => setPaying(null)} width={440}>
          <p>Fine for <strong>{paying.bookTitle}</strong></p>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 34, margin: '6px 0 14px' }}>{money(paying.amount)}</p>
          {!paying.returnedAt && <div className="info-box">This book is still overdue - the fine keeps growing until it is returned.</div>}
          <div className="info-box">Demo payment: no real money is charged. A real deployment would connect a payment gateway here.</div>
          <div className="modal-foot">
            <button className="btn secondary" onClick={() => setPaying(null)}>Cancel</button>
            <button className="btn gold" disabled={busy} onClick={pay}>{busy ? 'Processing…' : `Pay ${money(paying.amount)}`}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
