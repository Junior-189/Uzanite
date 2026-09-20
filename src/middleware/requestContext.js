const crypto = require('crypto');
const pinoHttp = require('pino-http');
const logger = require('../config/logger');
const metrics = require('../lib/metrics');
const { runWithTenant } = require('../context/tenantContext');

// Assigns/propagates a request id and emits one structured log line per request.
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (r) => ({ id: r.id, method: r.method, url: r.url }),
    res: (r) => ({ statusCode: r.statusCode }),
  },
});

// Establishes the AsyncLocalStorage tenant store for the request lifetime.
// `protect` later mutates it via setTenant() once the user is known.
function tenantContextMiddleware(req, res, next) {
  runWithTenant({ businessId: null, bypass: true, requestId: req.id }, () => next());
}

// Records request count + latency for /metrics.
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.inc('uzanite_http_requests_total', { method: req.method, status: String(res.statusCode) });
    metrics.observe('uzanite_http_request_duration_ms', ms, { method: req.method });
  });
  next();
}

module.exports = { httpLogger, tenantContextMiddleware, metricsMiddleware };
