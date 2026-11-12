import { useEffect } from 'react';
import { api, dateTime } from '../api.js';
import { Empty, Loadable, useAsync } from '../components/ui.jsx';

export const ICONS = {
  issued: ['📗', 'var(--green-soft)'],
  returned: ['✅', 'var(--green-soft)'],
  renewed: ['🔁', 'var(--blue-soft)'],
  due_soon: ['⏰', 'var(--gold-soft)'],
  overdue: ['⚠️', 'var(--red-soft)'],
  fine: ['₹', 'var(--red-soft)'],
  general: ['📢', 'var(--paper-2)'],
};

export default function Notifications() {
  const notes = useAsync(() => api.get('/notifications/me'), []);
  useEffect(() => {
    if (notes.data?.unread > 0) api.post('/notifications/me/read-all').catch(() => {});
  }, [notes.data]);

  return (
    <>
      <div className="page-head"><div><h1>Notifications</h1><p>Loan confirmations, due-date reminders and overdue notices. Copies are sent by email.</p></div></div>
      <div className="card">
        <Loadable state={notes}>
          {(d) => d.items.length === 0 ? <Empty title="Nothing yet">Notifications appear here when you borrow or return books.</Empty> : d.items.map((n) => {
            const [icon, bg] = ICONS[n.type] || ICONS.general;
            return (
              <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`}>
                <div className="ic" style={{ background: bg }}>{icon}</div>
                <div style={{ flex: 1 }}>
                  <div className="s">{n.subject}</div>
                  <div style={{ color: 'var(--ink-2)' }}>{n.message}</div>
                  <div className="small muted" style={{ marginTop: 4 }}>{dateTime(n.createdAt)}{n.channel === 'sns' && n.status === 'sent' ? ' · emailed' : ''}</div>
                </div>
              </div>
            );
          })}
        </Loadable>
      </div>
    </>
  );
}
