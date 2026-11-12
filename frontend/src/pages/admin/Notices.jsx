import { useState } from 'react';
import { api, dateTime } from '../../api.js';
import { Empty, Loadable, useAction, useAsync } from '../../components/ui.jsx';
import { ICONS } from '../Notifications.jsx';

export default function Notices() {
  const log = useAsync(() => api.get('/notifications/'), []);
  const [f, setF] = useState({ subject: '', message: '' });
  const [run, busy] = useAction();

  const send = async (e) => {
    e.preventDefault();
    if (await run(() => api.post('/notifications/announce', f), 'Announcement sent via Amazon SNS')) {
      setF({ subject: '', message: '' });
      log.reload();
    }
  };

  return (
    <>
      <div className="page-head"><div><h1>Notifications</h1><p>Every email sent by the system, delivered through Amazon SNS.</p></div></div>
      <div className="grid-3-1">
        <div className="card">
          <div className="card-head"><h3>Delivery log</h3><button className="btn secondary sm" onClick={log.reload}>Refresh</button></div>
          <Loadable state={log}>
            {(items) => items.length === 0 ? <Empty title="No notifications sent yet" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Type</th><th>Subject</th><th>To</th><th>Channel</th><th>Sent</th></tr></thead>
                <tbody>{items.map((n) => (
                  <tr key={n.id}>
                    <td>{(ICONS[n.type] || ICONS.general)[0]} <span className="small">{n.type}</span></td>
                    <td>{n.subject}</td>
                    <td className="small">{n.email || '—'}</td>
                    <td><span className={`badge ${n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : ''}`}>{n.channel} · {n.status}</span></td>
                    <td className="small nowrap">{dateTime(n.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Loadable>
        </div>
        <form className="card" onSubmit={send} style={{ alignSelf: 'start' }}>
          <h3>Send announcement</h3>
          <p className="small muted">Emailed to everyone subscribed to the library's SNS topic.</p>
          <div className="field"><label>Subject</label><input required minLength={3} maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></div>
          <div className="field"><label>Message</label><textarea required rows="5" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
          <button className="btn block" disabled={busy}>Send</button>
        </form>
      </div>
    </>
  );
}
