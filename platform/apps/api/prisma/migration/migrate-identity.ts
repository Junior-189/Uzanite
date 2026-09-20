/* eslint-disable no-console */
/**
 * Idempotent MongoDB -> PostgreSQL backfill for Identity & Tenancy (Phase M2).
 *
 *   MONGODB_URI=... DATABASE_URL=... pnpm migrate:identity
 *
 * Safety:
 *   - Refuses to run against a NON-EMPTY target unless MIGRATION_FORCE=true
 *     (idempotent re-runs: set MIGRATION_FORCE=true).
 *   - MIGRATION_DRY_RUN=true validates + reports without writing anything.
 *
 * Behaviour:
 *   - Maps legacy `businessId` -> tenants.slug, legacy `_id` -> legacy_id.
 *   - Migrates bcrypt password HASHES only (never plaintext); accounts without a
 *     hash are forced to reset (mustChangePassword = true).
 *   - Invalid/dirty rows are quarantined to a JSON report and skipped.
 */
import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Keep in sync with src/config/plans.ts and prisma/seed.ts.
const PLANS = [
  { key: 'free', name: 'Free', priceTzs: 0, limits: { products: 50, staff: 2, broadcastsPerMonth: 1, whatsappMessagesPerMonth: 500 }, features: { broadcast: true, reports: false, payments: false, api: false } },
  { key: 'pro', name: 'Pro', priceTzs: 25000, limits: { products: 2000, staff: 10, broadcastsPerMonth: 50, whatsappMessagesPerMonth: 20000 }, features: { broadcast: true, reports: true, payments: true, api: false } },
  { key: 'business', name: 'Business', priceTzs: 75000, limits: { products: -1, staff: -1, broadcastsPerMonth: -1, whatsappMessagesPerMonth: -1 }, features: { broadcast: true, reports: true, payments: true, api: true } },
];

const prisma = new PrismaClient();
const MONGO_URI = process.env.MONGODB_URI;
const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true';
const TENANT_STATUSES = new Set(['pending', 'approved', 'rejected', 'suspended']);
const PLAN_KEYS = new Set(['free', 'pro', 'business']);

interface QuarantineRow {
  entity: string;
  legacyId: string;
  reason: string;
  raw?: unknown;
}

const report: {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  counts: { tenants: number; users: number; memberships: number; subscriptions: number; featureFlags: number; aliases: number };
  quarantined: QuarantineRow[];
} = {
  startedAt: new Date().toISOString(),
  finishedAt: '',
  dryRun: DRY_RUN,
  counts: { tenants: 0, users: 0, memberships: 0, subscriptions: 0, featureFlags: 0, aliases: 0 },
  quarantined: [],
};

// C4: explicit, auditable identity mapping used to resolve legacy tokens.
async function linkUserAlias(userId: string, externalId: string, kind: 'user' | 'staff'): Promise<void> {
  if (DRY_RUN) return;
  await prisma.identityAlias.upsert({
    where: { provider_kind_externalId: { provider: 'legacy_mongo', kind, externalId } },
    update: { userId },
    create: { id: randomUUID(), provider: 'legacy_mongo', kind, externalId, userId, note: 'migrate-identity' },
  });
  report.counts.aliases++;
}

async function linkTenantAlias(tenantId: string, externalId: string): Promise<void> {
  if (DRY_RUN) return;
  await prisma.identityAlias.upsert({
    where: { provider_kind_externalId: { provider: 'legacy_mongo', kind: 'tenant', externalId } },
    update: { tenantId },
    create: { id: randomUUID(), provider: 'legacy_mongo', kind: 'tenant', externalId, tenantId, note: 'migrate-identity' },
  });
  report.counts.aliases++;
}

function quarantine(entity: string, legacyId: string, reason: string, raw?: unknown): void {
  report.quarantined.push({ entity, legacyId, reason, raw });
}

function mapPlanKey(value: unknown): string {
  const key = String(value ?? 'free').toLowerCase();
  return PLAN_KEYS.has(key) ? key : 'free';
}

// Subscriptions reference plans by key (FK), so ensure the catalog exists first.
async function ensurePlans(): Promise<void> {
  if (DRY_RUN) return;
  for (const plan of Object.values(PLANS)) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      update: { name: plan.name, priceTzs: plan.priceTzs, limits: plan.limits, features: plan.features },
      create: { key: plan.key, name: plan.name, priceTzs: plan.priceTzs, limits: plan.limits, features: plan.features },
    });
  }
}

async function migrateTenants(mongo: MongoClient): Promise<Map<string, string>> {
  const db = mongo.db();
  const tenants = await db.collection('users').find({ role: 'tenant' }).toArray();
  const businesses = await db.collection('businesses').find({}).toArray();
  const businessById = new Map(businesses.map((b) => [String(b.businessId), b]));
  const slugToUuid = new Map<string, string>();

  for (const u of tenants) {
    const slug = String(u.businessId ?? '').trim();
    if (!slug) {
      quarantine('tenant', String(u._id), 'missing businessId', u);
      continue;
    }
    const biz = businessById.get(slug);
    const name = String(u.businessName || biz?.name || u.name || slug);
    const status = TENANT_STATUSES.has(u.status) ? u.status : u.suspended ? 'suspended' : 'approved';
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    const id = existing?.id ?? randomUUID();
    if (!DRY_RUN) {
      await prisma.tenant.upsert({
        where: { slug },
        update: { name, status, legacyId: String(u._id) },
        create: { id, slug, name, status, phone: u.phone || biz?.phone || null, currency: (biz?.currency || 'TZS').slice(0, 3), legacyId: String(u._id) },
      });
    }
    slugToUuid.set(slug, id);
    // Alias both the business slug and the legacy tenant ObjectId.
    await linkTenantAlias(id, slug);
    await linkTenantAlias(id, String(u._id));
    report.counts.tenants++;
  }
  return slugToUuid;
}

async function migrateUsers(mongo: MongoClient): Promise<Map<string, string>> {
  const db = mongo.db();
  const users = await db.collection('users').find({}).toArray();
  const legacyToUuid = new Map<string, string>();

  for (const u of users) {
    const email = String(u.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      quarantine('user', String(u._id), 'missing/invalid email', u);
      continue;
    }
    const platformRole = u.role === 'super_admin' ? 'super_admin' : u.role === 'sub_admin' ? 'sub_admin' : null;
    const hasHash = typeof u.password === 'string' && u.password.length > 0;
    const existing = await prisma.user.findUnique({ where: { email } });
    const id = existing?.id ?? randomUUID();
    const status = u.status === 'rejected' ? 'rejected' : u.suspended ? 'suspended' : u.status === 'pending' ? 'pending' : 'active';
    const tokenVersion = Number.isFinite(u.tokenVersion) ? Number(u.tokenVersion) : 0;
    if (!DRY_RUN) {
      await prisma.user.upsert({
        where: { email },
        // tokenVersion is carried across so Express-issued access tokens (which
        // embed `tv`) validate against the platform user during dual-running.
        update: { name: u.name || email, platformRole, legacyId: String(u._id), tokenVersion },
        create: {
          id,
          email,
          name: u.name || email,
          phone: u.phone || null,
          passwordHash: hasHash ? u.password : null,
          authProvider: u.googleId ? 'google' : 'local',
          platformRole,
          status,
          tokenVersion,
          mustChangePassword: !hasHash,
          legacyId: String(u._id),
        },
      });
      await linkUserAlias(id, String(u._id), 'user');
    }
    legacyToUuid.set(String(u._id), id);
    report.counts.users++;
  }
  return legacyToUuid;
}

async function migrateMemberships(
  mongo: MongoClient,
  slugToUuid: Map<string, string>,
  legacyToUuid: Map<string, string>
): Promise<void> {
  const db = mongo.db();
  const tenantUsers = await db.collection('users').find({ role: 'tenant' }).toArray();
  for (const u of tenantUsers) {
    const tenantId = slugToUuid.get(String(u.businessId ?? ''));
    const userId = legacyToUuid.get(String(u._id));
    if (!tenantId || !userId) {
      quarantine('membership', String(u._id), 'unmapped tenant or user', u);
      continue;
    }
    if (!DRY_RUN) {
      await prisma.membership.upsert({
        where: { userId_tenantId: { userId, tenantId } },
        update: { role: 'owner', status: 'active' },
        create: { id: randomUUID(), userId, tenantId, role: 'owner', status: 'active', permissions: [] },
      });
    }
    report.counts.memberships++;
  }

  const staffs = await db.collection('staffs').find({}).toArray();
  for (const s of staffs) {
    const email = String(s.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      quarantine('staff', String(s._id), 'missing/invalid email', s);
      continue;
    }
    const hasHash = typeof s.password === 'string' && s.password.length > 0;
    const staffTv = Number.isFinite(s.tokenVersion) ? Number(s.tokenVersion) : 0;
    const user = DRY_RUN
      ? { id: `dry:${String(s._id)}` }
      : await prisma.user.upsert({
          where: { email },
          update: { legacyId: `staff:${String(s._id)}`, tokenVersion: staffTv },
          create: {
            id: randomUUID(),
            email,
            name: s.name || email,
            passwordHash: hasHash ? s.password : null,
            status: s.status === 'inactive' ? 'inactive' : 'active',
            tokenVersion: staffTv,
            mustChangePassword: !hasHash,
            legacyId: `staff:${String(s._id)}`,
          },
        });
    if (!DRY_RUN) await linkUserAlias(user.id, String(s._id), 'staff');
    const tenantId = slugToUuid.get(String(s.businessId ?? ''));
    if (!tenantId) {
      quarantine('staff', String(s._id), 'unmapped tenant', s);
      continue;
    }
    if (!DRY_RUN) {
      await prisma.membership.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId } },
        update: { role: 'staff', permissions: Array.isArray(s.permissions) ? s.permissions : [] },
        create: { id: randomUUID(), userId: user.id, tenantId, role: 'staff', status: 'active', permissions: Array.isArray(s.permissions) ? s.permissions : [] },
      });
    }
    report.counts.memberships++;
  }
}

async function migrateSubscriptions(mongo: MongoClient, slugToUuid: Map<string, string>): Promise<void> {
  const db = mongo.db();
  const tenants = await db.collection('users').find({ role: 'tenant' }).toArray();
  for (const u of tenants) {
    const tenantId = slugToUuid.get(String(u.businessId ?? ''));
    if (!tenantId) continue;
    const planKey = mapPlanKey(u.plan);
    const status = ['active', 'trialing', 'past_due', 'canceled'].includes(u.subscriptionStatus) ? u.subscriptionStatus : 'active';
    if (!DRY_RUN) {
      const existing = await prisma.subscription.findUnique({ where: { tenantId } });
      await prisma.subscription.upsert({
        where: { tenantId },
        update: { planKey, status },
        create: { id: existing?.id ?? randomUUID(), tenantId, planKey, status, trialEndsAt: u.trialEndsAt ? new Date(u.trialEndsAt) : null },
      });
    }
    report.counts.subscriptions++;
  }
}

async function migrateFeatureFlags(mongo: MongoClient): Promise<void> {
  const db = mongo.db();
  const flags = await db.collection('featureflags').find({}).toArray();
  for (const f of flags) {
    const scope = f.scope === 'tenant' ? 'tenant' : 'global';
    if (scope === 'tenant') {
      quarantine('featureFlag', String(f._id), 'tenant-scoped override deferred', f);
      continue;
    }
    if (!DRY_RUN) {
      try {
        await prisma.featureFlag.upsert({
          where: { legacyId: String(f._id) },
          update: { enabled: !!f.enabled, message: f.message ?? '' },
          create: { id: randomUUID(), legacyId: String(f._id), scope, tenantId: null, key: String(f.key), enabled: !!f.enabled, message: f.message ?? '' },
        });
      } catch (err) {
        quarantine('featureFlag', String(f._id), (err as Error).message, f);
        continue;
      }
    }
    report.counts.featureFlags++;
  }
}

async function main(): Promise<void> {
  if (!MONGO_URI) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  // Preflight: refuse a populated target unless forced (or dry-run).
  const [existingTenants, existingUsers] = await Promise.all([prisma.tenant.count(), prisma.user.count()]);
  if (!DRY_RUN && process.env.MIGRATION_FORCE !== 'true' && (existingTenants > 0 || existingUsers > 0)) {
    console.error(`❌ Target database is not empty (tenants=${existingTenants}, users=${existingUsers}).`);
    console.error('   Run against a clean database, or set MIGRATION_FORCE=true to proceed (idempotent upserts by legacy_id).');
    process.exit(1);
  }
  if (DRY_RUN) console.log('🧪 DRY RUN — no writes will be performed.');

  await ensurePlans();

  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  console.log('Connected to MongoDB');

  try {
    const slugToUuid = await migrateTenants(mongo);
    const legacyToUuid = await migrateUsers(mongo);
    await migrateMemberships(mongo, slugToUuid, legacyToUuid);
    await migrateSubscriptions(mongo, slugToUuid);
    await migrateFeatureFlags(mongo);
  } finally {
    await mongo.close();
  }

  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `migration-${stamp}.json`);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`${DRY_RUN ? 'DRY-RUN ' : ''}Migration complete:`, JSON.stringify(report.counts));
  console.log(`Quarantined: ${report.quarantined.length} -> ${file}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
