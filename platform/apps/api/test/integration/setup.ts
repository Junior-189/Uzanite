import { ConfigService } from '@nestjs/config';
import { PLAN_CATALOGUE } from '@uzanite/contracts';
import { JwtService } from '@nestjs/jwt';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { TokenService } from '../../src/security/token.service';
import { JwtKeyService } from '../../src/security/jwt-keys.service';
import { TotpService } from '../../src/security/totp.service';
import { LockoutService } from '../../src/security/lockout.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { AuthService } from '../../src/modules/identity/auth.service';
import { CacheService } from '../../src/cache/cache.service';
import { MetricsService } from '../../src/metrics/metrics.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';

export const hasDb = !!process.env.TEST_DATABASE_URL;

// Transient PostgreSQL failures a TRUNCATE may hit: deadlock, lock timeout.
const TRANSIENT_PG_CODES = ['40P01', '55P03', '40001'];

async function truncateWithRetry(exec: (sql: string) => Promise<unknown>, sql: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec(sql);
      return;
    } catch (err) {
      const message = (err as Error).message ?? '';
      const transient = TRANSIENT_PG_CODES.some((code) => message.includes(code)) || /deadlock/i.test(message);
      if (!transient || attempt === maxAttempts) throw err;
      // Jittered backoff so competing resetters do not collide again.
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 50));
    }
  }
}


// Point the app's PrismaService at the test database.
if (hasDb) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-0123456789abcdef0123456789abcdef';
process.env.JWT_ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
process.env.JWT_REFRESH_TTL_DAYS = process.env.JWT_REFRESH_TTL_DAYS || '30';
process.env.APP_URL = process.env.APP_URL || 'http://localhost:4000';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef0123456789abcdef';
process.env.STORAGE_SIGNING_SECRET = process.env.STORAGE_SIGNING_SECRET || 'test-storage-signing-secret-0123456789abcdef';
// Write test uploads to the OS temp dir, never inside the repository.
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || join(tmpdir(), 'uzanite-test-storage');

export interface Harness {
  prisma: PrismaService;
  auth: AuthService;
  redis: RedisService;
  config: ConfigService;
  uow: UnitOfWorkService;
  cache: CacheService;
  metrics: MetricsService;
  /** Entitlement service wired with the same cache the app uses. */
  billing: BillingService;
  tokens: TokenService;
  lockout: LockoutService;
  outbox: OutboxService;
}

export async function createHarness(): Promise<Harness> {
  const config = new ConfigService();
  const prisma = new PrismaService(config);
  await prisma.onModuleInit();
  const redis = new RedisService(config);
  const jwt = new JwtService({ secret: process.env.JWT_SECRET as string });
  const keys = new JwtKeyService(config, jwt);
  const tokens = new TokenService(jwt, prisma, config, keys);
  const totp = new TotpService(prisma);
  const lockout = new LockoutService(redis);
  const outbox = new OutboxService(prisma);
  const auth = new AuthService(prisma, tokens, lockout, outbox, config, totp);

  // Shared infrastructure, built once here so specs never have to know each
  // service's constructor signature.
  const metrics = new MetricsService();
  const cache = new CacheService(redis, metrics);
  const uow = new UnitOfWorkService(prisma);
  const billing = new BillingService(prisma, uow, cache, config);

  return { prisma, auth, redis, config, uow, cache, metrics, billing, tokens, lockout, outbox };
}

/**
 * Truncates every tenant-scoped table, with a bounded retry.
 *
 * TRUNCATE takes an AccessExclusiveLock on ~40 tables at once. Several Prisma
 * pools live in the same test process (each spec builds its own harness, and
 * the worker specs build their own client), so a reset can race an open
 * transaction on another pooled connection and Postgres resolves it by killing
 * one side with `40P01 deadlock detected`.
 *
 * That surfaced as intermittent, misleading failures elsewhere — foreign-key
 * violations and "Payment not found" in tests that had done nothing wrong.
 * A deadlock is transient by definition: the victim can simply try again.
 * Retrying here keeps the reset deterministic instead of making the whole
 * suite unreliable.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await truncateWithRetry((sql) => prisma.base.$executeRawUnsafe(sql), 'TRUNCATE "outbox_events","activity_logs","feature_flags","usage_counters","subscriptions","tenant_payment_methods","tenant_settings","memberships","membership_invites","refresh_tokens","password_reset_tokens","login_attempts","flow_traces","conversations","webhook_events","messages","whatsapp_contacts","whatsapp_templates","whatsapp_accounts","receipts","notifications","refunds","journal_lines","journal_entries","ledger_entries","payment_attempts","payments","order_status_history","order_items","orders","order_counters","stock_movements","products","categories","privacy_requests","stored_files","identity_aliases","staff","broadcast_logs","debts","purchases","expenses","users","tenants" RESTART IDENTITY CASCADE');
  // Seed the real plan catalogue: empty limits/features used to make every
  // entitlement test vacuously pass, which is how the plan-limit bugs survived.
  for (const plan of PLAN_CATALOGUE) {
    await prisma.base.plan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, priceTzs: plan.priceTzs, limits: plan.limits, features: plan.features },
      create: {
        key: plan.key,
        name: plan.name,
        priceTzs: plan.priceTzs,
        limits: plan.limits,
        features: plan.features,
      },
    });
  }
}
