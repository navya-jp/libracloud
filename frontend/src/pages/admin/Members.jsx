import { useState } from 'react';
import { api, date, qs } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Empty, ErrorBox, Loadable, Modal, Pager, SearchIcon, useAction, useAsync, useDebounced } from '../../components/ui.jsx';

function NewUser({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', role: 'member' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try { onSaved(await api.post('/auth/users', f)); } catch (err) { setError(err); }
  };
  return (
    <Modal title="Add a member" onClose={onClose} width={480}>
      <form onSubmit={save}>
        <ErrorBox error={error} />
        <div className="field"><label>Full name</label><input required value={f.name} onChange={set('name')} /></div>
        <div className="field"><label>Email</label><input type="email" required value={f.email} onChange={set('email')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Temporary password</label><input required minLength={8} value={f.password} onChange={set('password')} /></div>
        <div className="field"><label>Role</label>
          <select value={f.role} onChange={set('role')}><option value="member">Member</option><option value="librarian">Librarian</option></select></div>
        <div className="modal-foot"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">Create</button></div>
      </form>
    </Modal>
  );
}

export default function Members() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const users = useAsync(() => api.get(`/auth/users${qs({ q, page, limit: 20 })}`), [q, page]);
  const [run, busy] = useAction();

  const toggle = async (u) => {
    const status = u.status === 'active' ? 'suspended' : 'active';
    if (await run(() => api.patch(`/auth/users/${u.id}/status`, { status }), `${u.name} is now ${status}`)) users.reload();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Members</h1><p>Library accounts. Suspended members cannot log in or borrow.</p></div>
        <button className="btn" onClick={() => setAdding(true)}>+ Add member</button>
      </div>
      <div className="card">
        <div className="search" style={{ marginBottom: 12 }}><SearchIcon /><input placeholder="Search name or email" value={text} onChange={(e) => { setText(e.target.value); setPage(1); }} /></div>
        <Loadable state={users}>
          {(d) => d.items.length === 0 ? <Empty title="No members found" /> : (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th>Last login</th><th /></tr></thead>
                <tbody>{d.items.map((u) => (
                  <tr key={u.id}>
                    <td><span className="title">{u.name}</span><div className="small muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div></td>
                    <td><span className={`badge ${u.role === 'librarian' ? 'blue' : ''}`}>{u.role}</span></td>
                    <td><span className={`badge ${u.status === 'active' ? 'green' : 'red'}`}>{u.status}</span></td>
                    <td>{date(u.createdAt)}</td>
                    <td>{u.lastLoginAt ? date(u.lastLoginAt) : <span className="muted">never</span>}</td>
                    <td className="actions">{u.id !== user.id && (
                      <button className="btn secondary sm" disabled={busy} onClick={() => toggle(u)}>{u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                    )}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager page={d.page} pages={d.pages} onPage={setPage} />
            </>
          )}
        </Loadable>
      </div>
      {adding && <NewUser onClose={() => setAdding(false)} onSaved={(u) => { setAdding(false); users.reload(); run(async () => u, `Created account for ${u.name}`); }} />}
    </>
  );
}
