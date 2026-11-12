import { useEffect, useState } from 'react';
import { dateTime } from '../api.js';

// Live view of every microservice. Used in the "what changes when a service changes"
// demo: after pushing a change to one service, only that card's version and uptime change.
const SERVICES = [
  { key: 'auth', name: 'Auth service', role: 'Login, JWT tokens, member accounts' },
  { key: 'catalog', name: 'Catalog service', role: 'Books, search, S3 covers and e-books' },
  { key: 'circulation', name: 'Circulation service', role: 'Issue, return, renew, fines' },
  { key: 'notifications', name: 'Notification service', role: 'In-app notices, email via SNS' },
];

const fmtUptime = (s) => {
  if (s == null) return '—';
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

async function probe(key) {
  const t = performance.now();
  try {
    const res = await fetch(`/api/${key}/health`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    return { ...body, ok: res.ok && body.status === 'ok', ms: Math.round(performance.now() - t), code: res.status };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t), error: e.message };
  }
}

export default function Status() {
  const [data, setData] = useState({});
  const [at, setAt] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await Promise.all(SERVICES.map((s) => probe(s.key)));
      if (!alive) return;
      setData(Object.fromEntries(SERVICES.map((s, i) => [s.key, r[i]])));
      setAt(new Date());
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const up = Object.values(data).filter((d) => d.ok).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>System status</h1>
          <p>{at ? `${up} of ${SERVICES.length} services healthy · refreshed ${dateTime(at)} (every 5 s)` : 'Checking services…'}</p>
        </div>
      </div>
      <div className="svc">
        {SERVICES.map((s) => {
          const d = data[s.key] || {};
          return (
            <div className="card" key={s.key}>
              <div className="card-head">
                <h3><span className={`dot ${d.ok ? 'ok' : 'bad'}`} />{s.name}</h3>
                <span className={`badge ${d.ok ? 'green' : 'red'}`}>{at ? (d.ok ? 'Healthy' : 'Down') : '…'}</span>
              </div>
              <p className="small muted">{s.role}</p>
              <div className="kv"><span>Version</span><span className="mono">{d.version || '—'}</span></div>
              <div className="kv"><span>Uptime</span><span>{fmtUptime(d.uptimeSeconds)}</span></div>
              <div className="kv"><span>Started</span><span>{d.startedAt ? dateTime(d.startedAt) : '—'}</span></div>
              <div className="kv"><span>Database</span><span>{d.db || '—'}</span></div>
              <div className="kv"><span>Response time</span><span>{d.ms != null ? `${d.ms} ms` : '—'}</span></div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h3>Reading this page during a deployment</h3>
        <p className="small" style={{ margin: 0 }}>
          When a change to one service is pushed to GitHub, the CI/CD pipeline builds a new image for that service only.
          The EC2 deploy agent replaces just that container: its <strong>version</strong> changes and its <strong>uptime</strong> resets,
          while the other services keep running with no interruption. Detailed metrics and logs are in the Amazon CloudWatch dashboard.
        </p>
      </div>
    </>
  );
}
