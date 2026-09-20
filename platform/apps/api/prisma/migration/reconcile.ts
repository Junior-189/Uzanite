/* eslint-disable no-console */
/**
 * Reconciliation report: compares MongoDB source counts with the migrated rows
 * in PostgreSQL (scoped to rows carrying a `legacy_id`, so it is safe to run
 * against a database that also contains native platform data).
 *
 *   MONGODB_URI=... DATABASE_URL=... pnpm migrate:reconcile [--strict]
 *
 * With `--strict` (or RECONCILE_STRICT=true) it exits non-zero when any check
 * fails, so it can gate a deployment.
 */
import { MongoClient } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const MONGO_URI = process.env.MONGODB_URI;
const STRICT = process.env.RECONCILE_STRICT === 'true' || process.argv.includes('--strict');

function latestMigrationReport(): { quarantined?: Array<{ entity: string }> } | null {
  const dir = path.join(__dirname, 'reports');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('migration-')).sort();
  if (!files.length) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!MONGO_URI) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const db = mongo.db();

  const [mongoTenantUsers, mongoAllUsers, mongoStaffs, mongoBusinesses] = await Promise.all([
    db.collection('users').countDocuments({ role: 'tenant' }),
    db.collection('users').countDocuments({}),
    db.collection('staffs').countDocuments({}),
    db.collection('businesses').countDocuments({}),
  ]);

  // Scope Postgres counts to migrated rows only (legacy_id present).
  const [pgTenants, pgUsers, pgMemberships, pgSubscriptions] = await Promise.all([
    prisma.tenant.count({ where: { legacyId: { not: null } } }),
    prisma.user.count({ where: { legacyId: { not: null } } }),
    prisma.membership.count({ where: { tenant: { legacyId: { not: null } } } }),
    prisma.subscription.count({ where: { tenant: { legacyId: { not: null } } } }),
  ]);

  const migration = latestMigrationReport();
  const quarantined = migration?.quarantined ?? [];
  const qUsers = quarantined.filter((x) => x.entity === 'user' || x.entity === 'staff').length;
  const qMemberships = quarantined.filter((x) => x.entity === 'membership').length;

  const expected = {
    users: Math.max(0, mongoAllUsers - qUsers),
    memberships: Math.max(0, mongoTenantUsers + mongoStaffs - qMemberships),
  };

  const checks = [
    { name: 'users', actual: pgUsers, expected: expected.users, pass: pgUsers >= expected.users },
    { name: 'memberships', actual: pgMemberships, expected: expected.memberships, pass: pgMemberships >= expected.memberships },
  ];
  const allPass = checks.every((c) => c.pass);

  const report = {
    generatedAt: new Date().toISOString(),
    strict: STRICT,
    mongo: { tenantUsers: mongoTenantUsers, allUsers: mongoAllUsers, staffs: mongoStaffs, businesses: mongoBusinesses },
    postgres: { tenants: pgTenants, users: pgUsers, memberships: pgMemberships, subscriptions: pgSubscriptions },
    quarantine: { users: qUsers, memberships: qMemberships, total: quarantined.length },
    checks,
    pass: allPass,
  };

  const outDir = path.join(__dirname, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `reconcile-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  console.log('Reconciliation:', JSON.stringify(report, null, 2));
  console.log(`Report written to ${file}`);
  console.log(allPass ? '✅ Reconciliation PASS' : '❌ Reconciliation FAIL');

  await mongo.close();
  await prisma.$disconnect();

  if (STRICT && !allPass) process.exit(1);
}

main().catch(async (err) => {
  console.error('Reconciliation failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
