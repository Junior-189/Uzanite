import { PrismaClient } from '@prisma/client';

export const hasDb = !!process.env.TEST_DATABASE_URL;

// The worker creates its own PrismaClient from DATABASE_URL; point it at the
// test database before any client is constructed.
if (hasDb) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef0123456789abcdef';


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
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await truncateWithRetry((sql) => prisma.$executeRawUnsafe(sql), 'TRUNCATE "outbox_events","activity_logs","feature_flags","usage_counters","subscriptions","tenant_payment_methods","tenant_settings","memberships","membership_invites","refresh_tokens","password_reset_tokens","login_attempts","flow_traces","conversations","webhook_events","messages","whatsapp_contacts","whatsapp_templates","whatsapp_accounts","receipts","notifications","refunds","journal_lines","journal_entries","ledger_entries","payment_attempts","payments","order_status_history","order_items","orders","order_counters","stock_movements","products","categories","identity_aliases","users","tenants" RESTART IDENTITY CASCADE');
  for (const key of ['free', 'pro', 'business']) {
    await prisma.plan.upsert({ where: { key }, update: {}, create: { key, name: key, limits: {}, features: {} } });
  }
}
