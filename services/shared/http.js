// Common Express setup used by every service:
// security headers, request IDs, request logging + metrics, /health, error handling,
// and graceful shutdown (so a rolling redeploy never cuts off a request mid-way).

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const { logger, metrics, SERVICE, VERSION } = require('./logger');
const { HttpError } = require('./errors');
const db = require('./db');

const startedAt = Date.now();

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Number of proxies in front of the service: nginx (1). nginx passes the visitor's real IP
  // (from API Gateway's X-Client-Ip header on AWS) in X-Forwarded-For.
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    res.setHeader('x-service', `${SERVICE}@${VERSION}`);
    res.setHeader('cache-control', 'no-store');
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (req.path === '/health') return; // health probes are frequent - keep logs clean
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
      logger.info('request', {
        requestId: req.id,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(ms * 10) / 10,
        userId: req.user ? req.user.id : undefined,
      });
      metrics({
        Requests: { value: 1 },
        Latency: { value: ms, unit: 'Milliseconds' },
        Errors5xx: { value: res.statusCode >= 500 ? 1 : 0 },
      });
    });
    next();
  });

  app.get('/health', async (_req, res) => {
    let dbStatus = 'ok';
    try {
      await Promise.race([
        db.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
      ]);
    } catch {
      dbStatus = 'error';
    }
    const ok = dbStatus === 'ok';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      service: SERVICE,
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      startedAt: new Date(startedAt).toISOString(),
      db: dbStatus,
      time: new Date().toISOString(),
    });
  });

  return app;
}

function finalize(app) {
  app.use((req, _res, next) => next(new HttpError(404, `Not found: ${req.method} ${req.path}`)));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body');
    if (err.code === 'LIMIT_FILE_SIZE') err = new HttpError(413, 'File too large');
    const status = err.status || 500;
    if (status >= 500) logger.error('unhandled_error', { requestId: req.id, error: err.message, stack: err.stack });
    // Never leak internal error details (SQL, stack traces) to clients.
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
      details: status < 500 ? err.details : undefined,
      requestId: req.id,
    });
  });
  return app;
}

async function start(app, { port = Number(process.env.PORT || 3000), init } = {}) {
  await db.waitForDb();
  if (init) await init();
  const server = app.listen(port, () => {
    // This log line marks a deployment: CloudWatch Logs Insights can list every
    // "service_started" event to show when each service version went live.
    logger.info('service_started', { port, node: process.version });
  });

  const shutdown = (signal) => {
    logger.info('service_stopping', { signal });
    server.close(async () => {
      await db.pool.end().catch(() => {});
      logger.info('service_stopped');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

module.exports = { createApp, finalize, start, express };
