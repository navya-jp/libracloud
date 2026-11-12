// Service-to-service HTTP calls inside the Docker network.
const { HttpError } = require('./errors');

const URLS = {
  auth: process.env.AUTH_URL || 'http://auth:3000',
  catalog: process.env.CATALOG_URL || 'http://catalog:3000',
  circulation: process.env.CIRCULATION_URL || 'http://circulation:3000',
  notification: process.env.NOTIFICATION_URL || 'http://notification:3000',
};

function internalKey() {
  return process.env.INTERNAL_API_KEY || (process.env.NODE_ENV === 'production' ? '' : 'dev-internal-key');
}

async function callService(service, path, { method = 'GET', body, timeoutMs = 5000 } = {}) {
  let res;
  try {
    res = await fetch(URLS[service] + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-key': internalKey() },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new HttpError(503, `${service} service is unavailable`, { cause: err.message });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const e = new HttpError(res.status >= 500 ? 503 : res.status, (data && data.error) || `${service} call failed`);
    e.upstreamStatus = res.status;
    throw e;
  }
  return data;
}

module.exports = { callService, URLS };
