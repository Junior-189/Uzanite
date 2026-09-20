// Safe error responses for per-route catch blocks.
//
// The global error handler in server.js already hides internals in production,
// but 149 route handlers caught their own errors and returned `err.message`
// directly, bypassing it. That leaks stack-adjacent detail — Mongoose cast
// errors, duplicate-key messages with index names, connection strings in some
// driver errors — straight to the client.
//
// `sendServerError` keeps the operator's diagnosis (structured log with the
// request id) while giving the client a generic message in production.
const logger = require('../config/logger');

function sendServerError(res, err, req, fallback = 'Something went wrong. Please try again.') {
  const isProduction = process.env.NODE_ENV === 'production';

  logger.error(
    {
      err: err && err.message,
      stack: err && err.stack,
      requestId: (req && (req.id || req.requestId)) || undefined,
      path: req && req.originalUrl,
      method: req && req.method,
    },
    'route handler failed'
  );

  return res.status(500).json({
    success: false,
    // Non-production keeps the real message so local debugging is not harmed.
    error: isProduction ? fallback : (err && err.message) || fallback,
    ...(req && req.id ? { requestId: req.id } : {}),
  });
}

module.exports = { sendServerError };
