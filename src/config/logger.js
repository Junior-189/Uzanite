// Structured logging (Pino) with sensitive-field redaction.
// Phase 1: replaces ad-hoc console logging for request lifecycle + server events.
const pino = require('pino');
const config = require('./env');

const logger = pino({
  level: process.env.LOG_LEVEL || (config.isProd ? 'info' : 'debug'),
  base: { service: 'uzanite' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.confirmPassword',
      'req.body.token',
      'req.body.refreshToken',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
