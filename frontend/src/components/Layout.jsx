import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export function Logo({ size = 34 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#f4efe4" fillOpacity=".12" />
      <path d="M8 9h5v14H8zM14 9h4v14h-4z" fill="#f4efe4" />
      <path d="M19.5 10.2l3.9-1 3 13.6-3.9.9z" fill="#d9a441" />
    </svg>
  );
}

export default function Layout() {
  const { user, isLibrarian, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!user || isLibrarian) return undefined;
    const load = () => api.get('/notifications/me/unread-count').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [user, isLibrarian, loc.pathname]);

  const link = (to, label, extra) => (
    <NavLink to={to} end={to === '/' || to === '/admin'}>
      <span>{label}</span>{extra}
    </NavLink>
  );

  return (
    <div className="shell">
      <div className="mobile-bar">
        <strong style={{ fontFamily: 'var(--serif)', fontSize: 18 }}>LibraCloud</strong>
        <button onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
      </div>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">LibraCloud</div>
            <div className="brand-sub">Library on AWS</div>
          </div>
        </div>
        <nav className="nav">
          {link('/', 'Catalogue')}
          {user && !isLibrarian && (
            <>
              <div className="nav-label">My library</div>
              {link('/loans', 'My loans')}
              {link('/fines', 'Fines')}
              {link('/notifications', 'Notifications', unread > 0 ? <span className="count">{unread}</span> : null)}
            </>
          )}
          {isLibrarian && (
            <>
              <div className="nav-label">Librarian</div>
              {link('/admin', 'Dashboard')}
              {link('/admin/circulation', 'Issue & return')}
              {link('/admin/books', 'Manage books')}
              {link('/admin/members', 'Members')}
              {link('/admin/fines', 'Fines')}
              {link('/admin/notices', 'Notifications')}
              <div className="nav-label">Cloud</div>
              {link('/status', 'System status')}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          {user ? (
            <>
              <div className="who">{user.name}</div>
              <div style={{ opacity: 0.7 }}>{user.email}</div>
              <button className="btn ghost sm" onClick={() => { logout(); nav('/', { replace: true }); }}>Log out</button>
            </>
          ) : (
            <div className="row">
              <NavLink className="btn gold sm" to="/login">Log in</NavLink>
              <NavLink className="btn ghost sm" to="/register">Join</NavLink>
            </div>
          )}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
