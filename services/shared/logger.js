// Structured JSON logging + CloudWatch Embedded Metric Format (EMF).
//
// Every line written to stdout is JSON. On AWS the Docker "awslogs" driver ships
// stdout to CloudWatch Logs. Lines that contain an "_aws" block are automatically
// turned into CloudWatch custom metrics (namespace "LibraCloud") - no SDK calls,
// no extra cost per API call, and the metric stays next to the log that caused it.

const SERVICE = process.env.SERVICE_NAME || 'unknown-service';
const VERSION = process.env.SERVICE_VERSION || 'dev';
const EMF_ENABLED = process.env.EMF_ENABLED === 'true';
const NAMESPACE = process.env.METRICS_NAMESPACE || 'LibraCloud';

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function log(level, msg, fields = {}) {
  write({ ts: new Date().toISOString(), level, service: SERVICE, version: VERSION, msg, ...fields });
}

const logger = {
  info: (msg, fields) => log('info', msg, fields),
  warn: (msg, fields) => log('warn', msg, fields),
  error: (msg, fields) => log('error', msg, fields),
};

/**
 * Publish one or more metrics through EMF.
 * metrics: { MetricName: { value, unit } }   unit = Count | Milliseconds | None
 */
function metrics(values, extra = {}) {
  if (!EMF_ENABLED) return;
  const defs = Object.entries(values).map(([Name, m]) => ({ Name, Unit: m.unit || 'Count' }));
  const flat = Object.fromEntries(Object.entries(values).map(([k, m]) => [k, m.value]));
  write({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [['Service']], Metrics: defs }],
    },
    Service: SERVICE,
    version: VERSION,
    msg: 'metric',
    ...flat,
    ...extra,
  });
}

function metric(name, value = 1, unit = 'Count') {
  metrics({ [name]: { value, unit } });
}

module.exports = { logger, metric, metrics, SERVICE, VERSION };
