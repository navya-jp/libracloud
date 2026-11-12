// Thin wrapper around fetch for the four backend services behind the gateway.
//   /api/auth/*  /api/catalog/*  /api/circulation/*  /api/notifications/*

const TOKEN_KEY = 'libracloud.token';
let onUnauthorized = () => {};

export const tokenStore = {
  get() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(t) {
    try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
};

export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export class ApiError extends Error {
  constructor(status, message, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(method, path, body, { isForm = false } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body && !isForm) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: isForm ? body : body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const msg = (data && data.error) || (res.status === 502 || res.status === 503 || res.status === 504
      ? 'This service is temporarily unavailable. Please try again in a moment.'
      : `Request failed (${res.status})`);
    throw new ApiError(res.status, msg, data && data.requestId);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', p, fd, { isForm: true });
  },
};

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const relDays = (d) => {
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};
