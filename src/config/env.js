// Centralised environment validation.
// Loaded very early (server.js and middleware/auth.js) so the process FAILS FAST
// when security-critical configuration is missing or weak. Never falls back to a
// hardcoded secret — that was audit finding V4.

const PLACEHOLDER_SECRETS = new Set([
  'uzer-super-secret-key-2026',
  'your-secret-key-here',
  'secret',
  'changeme',
]);

function fatal(message) {
  // eslint-disable-next-line no-console
  console.error(`\n❌ FATAL CONFIG ERROR: ${message}\n`);
  process.exit(1);
}

function loadEnv() {
  const isProd = process.env.NODE_ENV === 'production';

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || !jwtSecret.trim()) {
    fatal(
      'JWT_SECRET is not set. Generate a strong secret with `openssl rand -hex 32` and set it in the environment.'
    );
  }
  if (jwtSecret.trim().length < 32) {
    fatal('JWT_SECRET must be at least 32 characters long.');
  }
  if (PLACEHOLDER_SECRETS.has(jwtSecret.trim())) {
    fatal('JWT_SECRET is set to a known placeholder. Set a unique, strong secret.');
  }

  if (isProd && !process.env.MONGODB_URI) {
    fatal('MONGODB_URI is required in production.');
  }

  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const transport = (process.env.WHATSAPP_TRANSPORT || 'meta').toLowerCase();
  if (!['meta', 'baileys'].includes(transport)) {
    fatal("WHATSAPP_TRANSPORT must be 'meta' or 'baileys'.");
  }

  return {
    isProd,
    jwtSecret: jwtSecret.trim(),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    corsOrigins,
    metaAppSecret: process.env.META_APP_SECRET || '',
    metaVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    metaGraphVersion: process.env.META_GRAPH_VERSION || 'v21.0',
    whatsappTransport: transport,
    redisUrl: process.env.REDIS_URL || '',
    // Optional: required only when storing per-tenant Meta tokens at rest.
    encryptionKey: process.env.ENCRYPTION_KEY || '',

    // ── Payments (Phase 3) ──
    paymentsDefaultProvider: (process.env.PAYMENTS_DEFAULT_PROVIDER || 'manual').toLowerCase(),
    clickpesa: {
      baseUrl: process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com',
      clientId: process.env.CLICKPESA_CLIENT_ID || '',
      apiKey: process.env.CLICKPESA_API_KEY || '',
      webhookSecret: process.env.CLICKPESA_WEBHOOK_SECRET || '',
    },
    azampay: {
      baseUrl: process.env.AZAMPAY_BASE_URL || 'https://authenticator.azampay.co.tz',
      appName: process.env.AZAMPAY_APP_NAME || '',
      clientId: process.env.AZAMPAY_CLIENT_ID || '',
      clientSecret: process.env.AZAMPAY_CLIENT_SECRET || '',
      webhookSecret: process.env.AZAMPAY_WEBHOOK_SECRET || '',
    },

    // ── Object storage (Phase 3) ──
    storage: {
      provider: (process.env.STORAGE_PROVIDER || 'local').toLowerCase(),
      localDir: process.env.STORAGE_LOCAL_DIR || 'private_uploads',
      signingSecret: process.env.STORAGE_SIGNING_SECRET || '',
      urlTtlSeconds: parseInt(process.env.STORAGE_URL_TTL_SECONDS || '900', 10),
      retentionDays: parseInt(process.env.STORAGE_RETENTION_DAYS || '0', 10),
      s3: {
        bucket: process.env.S3_BUCKET || '',
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || '',
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    },
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  };
}

module.exports = loadEnv();
