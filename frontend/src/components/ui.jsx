import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------- toasts ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, message, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------- data loading ----------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { ...state, reload };
}

// Runs an action, shows a toast, reports busy state.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (err) {
      toast(err.message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

// ---------- small components ----------
export const Spinner = () => <div className="spinner" aria-label="Loading" />;

export function Empty({ title, children }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="error-box">{error.message || String(error)}</div>;
}

export function Loadable({ state, children, empty }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <ErrorBox error={state.error} />;
  if (empty && empty(state.data)) return empty.render || null;
  return children(state.data);
}

export function Modal({ title, onClose, children, width }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pager({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn secondary sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <span className="muted">Page {page} of {pages}</span>
      <button className="btn secondary sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

const LOAN_BADGE = { active: ['green', 'On loan'], overdue: ['red', 'Overdue'], returned: ['', 'Returned'] };
export function LoanBadge({ loan }) {
  const late = !loan.returnedAt && loan.overdueDays > 0;
  const [cls, text] = late ? LOAN_BADGE.overdue : LOAN_BADGE[loan.returnedAt ? 'returned' : 'active'];
  return <span className={`badge ${cls}`}>{late ? `${loan.overdueDays}d overdue` : text}</span>;
}

export function Availability({ book }) {
  if (book.availableCopies > 0) {
    return <span className="badge green">{book.availableCopies} of {book.totalCopies} available</span>;
  }
  return <span className="badge gold">All {book.totalCopies} on loan</span>;
}

export function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// Debounce a fast-changing value (search boxes).
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
