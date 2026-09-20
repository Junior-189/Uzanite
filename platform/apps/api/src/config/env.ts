import { z } from 'zod';

// Known weak/example values that must never be accepted as real secrets.
// Compared case-insensitively as exact values or substrings.
const PLACEHOLDER_SECRETS = [
  'change-me',
  'changeme',
  'change_me',
  'placeholder',
  'replace-me',
  'replace_me',
  'your-secret',
  'your_secret',
  'your-encryption-key',
  'your_encryption_key',
  'admin@12345!',
  'password123',
  'example',
  'test-secret',
];

export function isPlaceholderSecret(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return PLACEHOLDER_SECRETS.some((p) => v === p || v.includes(p));
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    // Number of trusted reverse proxies in front of the API. Load-bearing for
    // rate limiting: see the `trust proxy` note in main.ts. 0 = direct exposure.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().optional().default(''),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),
    ENCRYPTION_KEY: z.string().optional().default(''),
    APP_URL: z.string().default('http://localhost:4000'),
    PUBLIC_APP_URL: z.string().optional().default(''),
    LOG_LEVEL: z.string().default('info'),
    CORS_ORIGINS: z.string().optional().default('http://localhost:5173,http://localhost:3000'),
    // Row Level Security must run through a non-owner DB role (see prisma/sql/ci-roles.sql).
    RLS_ENABLED: z.enum(['true', 'false']).optional().default('false'),
    IMPERSONATION_TTL: z.string().default('30m'),
    // Read-through cache TTLs (seconds). 0 disables that cache entirely.
    CACHE_MEMBERSHIP_TTL: z.coerce.number().int().min(0).default(60),
    CACHE_BILLING_TTL: z.coerce.number().int().min(0).default(60),
    // Hard ceiling on any outbound third-party HTTP call (milliseconds).
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(8000),
    // PostgreSQL guard rails applied on every connection.
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15000),
    DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(0).default(5000),
    DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().min(0).default(15000),
    // Data retention (days). 0 disables that sweep.
    RETENTION_FLOW_TRACE_DAYS: z.coerce.number().int().min(0).default(90),
    RETENTION_WEBHOOK_EVENT_DAYS: z.coerce.number().int().min(0).default(30),
    RETENTION_LOGIN_ATTEMPT_DAYS: z.coerce.number().int().min(0).default(90),
    RETENTION_ACTIVITY_LOG_DAYS: z.coerce.number().int().min(0).default(365),
    // Protect the Prometheus scrape endpoint. When set it is required (header
    // `x-metrics-token` or `?token=`). When unset, /metrics is only exposed in
    // non-production environments.
    METRICS_TOKEN: z.string().optional().default(''),
    // Observability (all optional — logging-only when unset).
    SENTRY_DSN: z.string().optional().default(''),
    APP_RELEASE: z.string().optional().default('unknown'),
    OTEL_SERVICE_NAME: z.string().optional().default('uzanite-api'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),
    // Meta WhatsApp Cloud API (optional — messaging endpoints are disabled without them)
    META_APP_SECRET: z.string().optional().default(''),
    META_VERIFY_TOKEN: z.string().optional().default(''),
    META_GRAPH_VERSION: z.string().optional().default('v21.0'),
    // Global conversation-flow fallback when a tenant has no explicit mode (M8).
    WHATSAPP_FLOW_MODE: z.enum(['off', 'shadow', 'active']).optional().default('off'),
    // SMTP (optional — email is logged when unset)
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    EMAIL_FROM: z.string().optional().default('UZANITE <no-reply@uzanite.local>'),
  })
  // ── Production hardening ───────────────────────────────────────────────────
  // These only apply when NODE_ENV=production. Failing fast at boot is far safer
  // than silently running a pilot without tenant isolation, shared rate limits,
  // or secret encryption.
  .superRefine((cfg, ctx) => {
    const addIssue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    // Placeholder/example secrets are rejected everywhere except the test env
    // (integration suites use deterministic fixtures).
    if (cfg.NODE_ENV !== 'test' && isPlaceholderSecret(cfg.JWT_SECRET)) {
      addIssue('JWT_SECRET', 'JWT_SECRET looks like a placeholder — generate one with `openssl rand -hex 32`');
    }

    if (cfg.NODE_ENV !== 'production') return;
    const require = (cond: boolean, path: string, message: string) => {
      if (!cond) addIssue(path, message);
    };
    require(cfg.RLS_ENABLED === 'true', 'RLS_ENABLED', 'RLS_ENABLED must be "true" in production (non-owner DB role)');
    require(!!cfg.REDIS_URL, 'REDIS_URL', 'REDIS_URL is required in production (shared rate limits, lockouts, queues)');
    require(!!cfg.ENCRYPTION_KEY, 'ENCRYPTION_KEY', 'ENCRYPTION_KEY is required in production (encrypts per-tenant Meta tokens)');
    const origins = cfg.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    require(
      origins.length > 0 && origins.every((o) => !o.includes('localhost') && !o.startsWith('http://')),
      'CORS_ORIGINS',
      'CORS_ORIGINS must list explicit https origins in production (no localhost/http)'
    );
    require(!!cfg.META_APP_SECRET || cfg.WHATSAPP_FLOW_MODE !== 'active', 'META_APP_SECRET', 'META_APP_SECRET is required when WHATSAPP_FLOW_MODE=active');
  });

export type Env = z.infer<typeof envSchema>;

// Fail-fast validation used by ConfigModule.forRoot({ validate }).
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`\n❌ Invalid environment configuration:\n${details}\n`);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}
