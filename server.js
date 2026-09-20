require('dotenv').config();
// Fail fast on missing/weak security config BEFORE anything else loads.
require('./src/config/env');
const express = require('express');
const fs = require('fs');
const path = require('path');
const connectDB = require('./src/config/database');
const config = require('./src/config/env');
const {
  buildCors,
  securityHeaders,
  sanitize,
  authLimiter,
  apiLimiter,
  broadcastLimiter,
  webhookLimiter,
  metricsLimiter,
} = require('./src/middleware/security');
const { httpLogger, tenantContextMiddleware, metricsMiddleware } = require('./src/middleware/requestContext');
const logger = require('./src/config/logger');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────
// Behind Render/Netlify proxies — required for correct req.ip + rate limiting.
app.set('trust proxy', 1);
// Structured request logging + request id (X-Request-Id).
app.use(httpLogger);
// Request count + latency metrics.
app.use(metricsMiddleware);
// Request-scoped tenant context for the tenantScope Mongoose plugin.
app.use(tenantContextMiddleware);
app.use(securityHeaders());
app.use(buildCors());
// Capture the raw body so webhook HMAC signatures can be verified.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
// Strip MongoDB operators ($, .) from user input.
app.use(sanitize);

// Rate limiting (audit finding V8).
app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/staff/login', authLimiter);
app.use('/api/broadcast', broadcastLimiter);
// Webhooks and metrics live outside /api; they still need abuse ceilings.
app.use('/webhook', webhookLimiter);
app.use('/metrics', metricsLimiter);

// Serve uploaded product images (see Phase 0 report re: private storage).
app.use(
  '/uploads',
  express.static(require('./src/config/uploads').uploadDirAbs, {
    index: false,
    dotfiles: 'deny',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  })
);

// ── Serve static files (Admin SPA + favicon) ─────────────────────────────────
// React build (production)
app.use('/admin', express.static(path.join(__dirname, 'client', 'dist')));

// ── Routes ───────────────────────────────────────────────────────────
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/businesses', require('./src/routes/businesses'));
app.use('/api/contacts', require('./src/routes/contacts'));
app.use('/api/broadcast', require('./src/routes/broadcast'));
app.use('/api/chat', require('./src/routes/chat'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/admin', require('./src/routes/admin'));
app.use('/api/admin', require('./src/routes/featureFlags'));
app.use('/api/whatsapp', require('./src/routes/whatsapp'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/recycle-bin', require('./src/routes/recycleBin'));
app.use('/api/expenses', require('./src/routes/expenses'));
app.use('/api/debts', require('./src/routes/debts'));
app.use('/api/purchases', require('./src/routes/purchases'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/staff', require('./src/routes/staff'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/ledger', require('./src/routes/ledger'));
app.use('/api/analytics', require('./src/routes/analytics'));
app.use('/api/billing', require('./src/routes/billing'));
app.use('/api/privacy', require('./src/routes/privacy'));
app.use('/api/files', require('./src/routes/files'));
app.use('/api/admin', require('./src/routes/activityLogs'));
app.use('/api/admin/queues', require('./src/routes/adminQueues'));
app.use('/api/admin/privacy', require('./src/routes/adminPrivacy'));
app.use('/webhook/payments', require('./src/routes/paymentWebhook'));
app.use('/webhook', require('./src/routes/webhook')); // Meta Cloud API webhook
app.use('/metrics', require('./src/routes/metrics'));

// Liveness probe — process is up.
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'UZANITE',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe — dependencies (MongoDB + Redis when configured) are usable.
app.get('/ready', async (req, res) => {
  const mongoose = require('mongoose');
  const dbReady = mongoose.connection.readyState === 1; // 1 = connected

  let redisState = 'disabled';
  if (config.redisUrl) {
    try {
      const { getRedisConnection } = require('./src/queue/queues');
      const conn = getRedisConnection();
      redisState = conn && conn.status === 'ready' ? 'up' : 'down';
    } catch {
      redisState = 'down';
    }
  }

  const ready = dbReady && redisState !== 'down';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    service: 'UZANITE',
    checks: { mongodb: dbReady ? 'up' : 'down', redis: redisState },
    transport: config.whatsappTransport,
    timestamp: new Date().toISOString(),
  });
});

// Root: serve React SPA (landing page)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// Serve APK download before SPA catch-all
app.get('/admin/app-debug.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'client', 'dist', 'app-debug.apk');
  if (require('fs').existsSync(apkPath)) {
    res.download(apkPath, 'UZANITE.apk');
  } else {
    res.status(404).json({ success: false, error: 'APK not found. Rebuild the client first.' });
  }
});

// Serve desktop setup download before SPA catch-all
app.get('/admin/UZANITE-Setup.exe', (req, res) => {
  const exePath = path.join(__dirname, 'client', 'dist', 'UZANITE-Setup.exe');
  if (fs.existsSync(exePath)) {
    res.download(exePath, 'UZANITE-Setup.exe');
  } else {
    res.status(404).json({ success: false, error: 'Desktop setup not found. Build it with: npm run electron:build-installer' });
  }
});

// React SPA catch-all: serve index.html for /admin/* routes
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// 404 handler
app.use((req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

// Global error handler — never leak internals to clients in production.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(500).json({ success: false, error: message });
});

// NOTE (Phase 0): the automatic default tenant and the plaintext
// `initialPassword` backfill were removed. Accounts must now be created via the
// secure bootstrap script (scripts/seedSuperAdmin.js), which requires explicit
// BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD env vars and forces a
// password change on first login.

// ── Startup ───────────────────────────────────────────────────────────
let httpServer = null;

const start = async () => {
  await connectDB();

  // Configuration sanity warnings (never block startup).
  if (config.whatsappTransport === 'meta' && !config.encryptionKey) {
    logger.warn('ENCRYPTION_KEY is not set — tenants cannot store Meta credentials.');
  }
  if (config.storage.provider === 'local' && !config.storage.signingSecret) {
    logger.warn('STORAGE_SIGNING_SECRET is not set — signed file URLs will be unusable.');
  }
  if (config.redisUrl) {
    const { getRedis } = require('./src/lib/redis');
    getRedis()
      .ping()
      .then(() => logger.info('Redis connectivity OK'))
      .catch((e) => logger.warn({ err: e.message }, 'Redis unreachable'));
    try {
      require('./src/services/featureFlagService').initFlagsInvalidation();
    } catch (err) {
      logger.warn({ err: err.message }, 'Feature-flag invalidation init failed');
    }
  } else {
    logger.warn('REDIS_URL is not set — using in-process queues/state (single instance only).');
  }

  // Guard against the fail-open tenant sentinel becoming a real tenant id.
  // If a tenant literally owns businessId 'default', every unscoped write
  // becomes their readable data — so refuse to serve rather than leak.
  try {
    const { assertNoDefaultTenant } = require('./src/models/plugins/tenantScope');
    await assertNoDefaultTenant(require('./src/models/User'));
  } catch (err) {
    logger.error({ err: err.message }, 'Tenant isolation precondition failed');
    throw err;
  }

  // Ensure global feature-flag rows exist for every toggleable feature.
  try {
    await require('./src/routes/featureFlags').ensureGlobalFlags();
  } catch (err) {
    console.error('⚠️  Feature flag seed failed:', err.message);
  }

  // Legacy Baileys transport is opt-in only (default is the Meta Cloud API).
  if (config.whatsappTransport === 'baileys') {
    try {
      const { connectWhatsApp } = require('./src/whatsapp/client');
      await connectWhatsApp();
    } catch (err) {
      console.error('⚠️  Baileys WhatsApp connection failed (will retry):', err.message);
    }
  }

  // Start messaging workers. With Redis, a dedicated `npm run worker` process is
  // preferred; set RUN_WORKER_IN_PROCESS=false to disable in-process workers.
  if (!(config.redisUrl && process.env.RUN_WORKER_IN_PROCESS === 'false')) {
    try {
      const { startWorkers } = require('./src/queue/worker');
      await startWorkers();
    } catch (err) {
      console.error('⚠️  Worker startup failed:', err.message);
    }
  }

  // Maintenance scans are enqueued (processed by the worker) shortly after boot
  // and then daily.
  const { enqueue } = require('./src/queue/queues');
  const runMaintenance = () => {
    enqueue('maintenance', 'expiry-scan', {}).catch(() => {});
    enqueue('maintenance', 'low-stock-scan', {}).catch(() => {});
    enqueue('maintenance', 'storage-retention', {}).catch(() => {});
  };
  setTimeout(runMaintenance, 30000);
  setInterval(runMaintenance, 24 * 60 * 60 * 1000);

  const PORT = process.env.PORT || 3000;
  httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 UZANITE running on port ${PORT}`);
    console.log(`📦 Business: ${process.env.BUSINESS_NAME || 'Not set — update .env'}`);
    console.log(`📡 Health: http://localhost:${PORT}/health`);
    console.log(`📚 Products API: http://localhost:${PORT}/api/products`);
    console.log(`📋 Orders API: http://localhost:${PORT}/api/orders`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/admin`);
    console.log(`\n🔐 Accounts: create the super admin with scripts/seedSuperAdmin.js\n`);
  });

  // Handle port already in use error
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use!`);
      console.error('Options:');
      console.error(`  1. Kill the process: netstat -ano | findstr :${PORT}`);
      console.error(`  2. Use a different port: set PORT=3001 && node server.js`);
      console.error(`  3. Update .env: PORT=${PORT + 1}\n`);
      process.exit(1);
    }
    throw err;
  });
};

// ── Graceful shutdown ─────────────────────────────────────────────────
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  try {
    if (httpServer) httpServer.close();
  } catch { /* ignore */ }
  try {
    const { stopWorkers } = require('./src/queue/worker');
    await stopWorkers();
  } catch { /* ignore */ }
  try {
    await require('mongoose').disconnect();
  } catch { /* ignore */ }
  try {
    const { closeRedis } = require('./src/lib/redis');
    await closeRedis();
  } catch { /* ignore */ }
  // Force-exit if graceful close stalls.
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
