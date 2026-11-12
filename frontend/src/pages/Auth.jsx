import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

const SPINES = [
  ['#c8932f', 120], ['#e8dfcc', 150], ['#7a3b2e', 135], ['#f1ede3', 165], ['#2d4f6c', 110], ['#d9a441', 145],
  ['#e8dfcc', 125], ['#5b4a7a', 160], ['#c8932f', 100], ['#f1ede3', 140], ['#8a6420', 155], ['#e8dfcc', 118],
];

function Art() {
  return (
    <div className="auth-art">
      <div className="brand" style={{ padding: 0 }}>
        <Logo size={40} />
        <div><div className="brand-name">LibraCloud</div><div className="brand-sub">Library on AWS</div></div>
      </div>
      <div>
        <h1>Every book in the library, one search away.</h1>
        <p>Browse the catalogue, borrow books, renew before the due date and get reminders by email. Running on Amazon Web Services.</p>
      </div>
      <div className="shelf" aria-hidden="true">
        {SPINES.map(([c, h], i) => <span key={i} style={{ background: c, height: h, opacity: 0.9 }} />)}
      </div>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.role === 'librarian' ? '/admin' : '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      const home = u.role === 'librarian' ? '/admin' : '/';
      const from = loc.state?.from;
      const memberOnly = ['/loans', '/fines', '/notifications'];
      const allowed = from && !(u.role === 'librarian' && memberOnly.includes(from)) && !(u.role !== 'librarian' && (from.startsWith('/admin') || from === '/status'));
      nav(allowed ? from : home, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        <form className="box" onSubmit={submit}>
          <h1>Welcome back</h1>
          <p className="muted">Log in to borrow books and manage your loans.</p>
          <ErrorBox error={error} />
          <div className="field"><label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">Password</label>
            <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <button className="btn block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          <p className="small" style={{ marginTop: 16 }}>New here? <Link to="/register">Create a member account</Link> · <Link to="/">Browse without logging in</Link></p>
        </form>
      </div>
    </div>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(f);
      nav('/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Art />
      <div className="auth-form">
        <form className="box" onSubmit={submit}>
          <h1>Become a member</h1>
          <p className="muted">Free membership. Borrow up to 3 books at a time for 14 days.</p>
          <ErrorBox error={error} />
          <div className="field"><label htmlFor="n">Full name</label><input id="n" required value={f.name} onChange={set('name')} autoComplete="name" /></div>
          <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="field"><label htmlFor="p">Phone (optional)</label><input id="p" value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
          <div className="field"><label htmlFor="pw">Password</label>
            <input id="pw" type="password" required minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" />
            <div className="small muted" style={{ marginTop: 4 }}>At least 8 characters, with a letter and a number.</div></div>
          <button className="btn block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
          <p className="small" style={{ marginTop: 16 }}>Already a member? <Link to="/login">Log in</Link></p>
        </form>
      </div>
    </div>
  );
}
