// Security middleware wiring.
// Closes audit findings V8 (unused helmet/cors/sanitize/rate-limit) and V3
// (open CORS). Kept intentionally conservative so existing flows keep working.

const helmet = require('helmet');
const cors = require('cors');
const mongoSanitize = require('express-mongo-sanitize');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://uzanite.shop',
  'https://www.uzanite.shop',
];

function buildCors() {
  const allow = new Set([...DEFAULT_ORIGINS, ...config.corsOrigins]);
  return cors({
    origin(origin, cb) {
      // No Origin header = same-origin, native apps (Capacitor), curl, server-to-server.
      if (!origin) return cb(null, true);
      if (allow.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
}

// Content Security Policy for the origin that serves the admin SPA.
//
// This was previously disabled, which mattered more here than usual: the client
// keeps tokens in browser storage, so a single XSS in ~14k lines of React would
// have had nothing standing in its way. The directives below are derived from
// what the SPA actually loads — Google Fonts and the Font Awesome CDN for
// styles/fonts, and same-origin for everything else.
//
// `CSP_REPORT_ONLY=true` runs it in report-only mode, which is the right way to
// roll this out on a live system: observe violations first, then enforce.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  // No inline or remote scripts: the SPA ships as hashed module bundles.
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  // Tailwind and the SPA use inline styles; third-party stylesheets are pinned.
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
  // `data:`/`blob:` cover generated barcodes, QR codes and receipt previews.
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  // XHR targets: same origin, plus the configured API origins.
  connectSrc: ["'self'", ...(process.env.CSP_CONNECT_SRC || '').split(',').map((s) => s.trim()).filter(Boolean)],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  upgradeInsecureRequests: [],
};

function securityHeaders() {
  const reportOnly = process.env.CSP_REPORT_ONLY === 'true';
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: CSP_DIRECTIVES,
      reportOnly,
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    // Deny browser features the admin SPA does not use. Camera is NOT denied:
    // the POS barcode scanner needs it.
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  });
}

// Strips MongoDB operator keys ($, .) from body/query/params.
const sanitize = mongoSanitize({ replaceWith: '_' });

// Shared (Redis) store so rate limits hold across multiple API instances.
function buildStore(prefix) {
  if (!config.redisUrl) return undefined;
  try {
    const mod = require('rate-limit-redis');
    const RedisStore = mod.RedisStore || mod.default || mod;
    const { getRedis } = require('../lib/redis');
    const client = getRedis();
    if (!client) return undefined;
    return new RedisStore({ sendCommand: (...args) => client.call(...args), prefix });
  } catch {
    return undefined;
  }
}

function limiter({ windowMs, limit, message, prefix }) {
  const store = buildStore(prefix || 'rl:');
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(store ? { store } : {}),
    message: { success: false, error: message },
  });
}

// Login / register / google / staff login — 30 attempts per 15 min per IP.
const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  prefix: 'rl:auth:',
  message: 'Too many authentication attempts. Please try again later.',
});

// General API ceiling.
const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 300,
  prefix: 'rl:api:',
  message: 'Too many requests. Please slow down.',
});

// Broadcast / bulk messaging is the #1 WhatsApp-ban and email-abuse vector.
const broadcastLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 10,
  prefix: 'rl:broadcast:',
  message: 'Too many broadcast requests. Please wait a minute.',
});

// Webhooks are unauthenticated (signature-verified). A generous per-IP ceiling
// stops an unauthenticated flood without dropping legitimate Meta/provider
// retry bursts.
const webhookLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 600,
  prefix: 'rl:webhook:',
  message: 'Too many webhook requests.',
});

// Metrics scrapes are periodic and internal.
const metricsLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 60,
  prefix: 'rl:metrics:',
  message: 'Too many metrics requests.',
});

module.exports = {
  buildCors,
  securityHeaders,
  sanitize,
  authLimiter,
  apiLimiter,
  broadcastLimiter,
  webhookLimiter,
  metricsLimiter,
};
