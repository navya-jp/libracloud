// PostgreSQL connection pool (local Postgres in Docker, Amazon RDS on AWS).
// Connection settings come from the standard PG* environment variables
// (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE). On AWS the password is
// loaded from AWS Secrets Manager by the EC2 setup script - never stored in code.

const fs = require('fs');
const { Pool } = require('pg');
const { logger } = require('./logger');

function sslConfig() {
  if (process.env.DB_SSL !== 'true') return false;
  // RDS for PostgreSQL 15+ forces SSL. With the RDS CA bundle we also verify the
  // server certificate (prevents man-in-the-middle attacks).
  const caPath = process.env.DB_SSL_CA;
  if (caPath && fs.existsSync(caPath)) {
    return { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true };
  }
  logger.warn('DB_SSL_CA not found - using encrypted connection without certificate verification');
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'libracloud',
  password: process.env.PGPASSWORD || 'libracloud',
  database: process.env.PGDATABASE || 'libracloud',
  ssl: sslConfig(),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => logger.error('db_pool_error', { error: err.message }));

const query = (text, params) => pool.query(text, params);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// The database may start after the service (docker compose) or be briefly
// unavailable (RDS maintenance). Retry instead of crashing.
async function waitForDb(attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      logger.info('db_connected', { host: process.env.PGHOST || 'localhost' });
      return;
    } catch (err) {
      logger.warn('db_not_ready', { attempt: i, error: err.message });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Database not reachable');
}

module.exports = { pool, query, withTransaction, waitForDb };
