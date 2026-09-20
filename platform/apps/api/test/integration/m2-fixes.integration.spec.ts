import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { getDb, runWithRequest } from '../../src/context/tenant-context';

// Requires a NON-owner app-role URL so RLS is actually enforced.
const enabled = !!process.env.TEST_DATABASE_URL && !!process.env.TEST_APP_DATABASE_URL;
const d = enabled ? describe : describe.skip;

// Regression tests for M2 gate C1 fixes #2–#4, exercised through the real
// app-role connection with RLS enabled.
d('M2 RLS fixes (app role + RLS)', () => {
  let admin: PrismaClient;
  let appPrisma: PrismaService;
  let uow: UnitOfWorkService;
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
    // Construct a PrismaService bound to the non-owner role.
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = process.env.TEST_APP_DATABASE_URL as string;
    appPrisma = new PrismaService();
    process.env.DATABASE_URL = prev;
    await appPrisma.onModuleInit();
    uow = new UnitOfWorkService(appPrisma);

    await admin.$executeRawUnsafe('TRUNCATE "memberships","users","tenants" RESTART IDENTITY CASCADE');
    tenantId = randomUUID();
    userId = randomUUID();
    await admin.tenant.create({ data: { id: tenantId, slug: `m2fix-${tenantId.slice(0, 8)}`, name: 'Fix', status: 'approved' } });
    await admin.user.create({ data: { id: userId, email: `m2fix-${tenantId.slice(0, 8)}@x.com`, name: 'Fix', status: 'active' } });
    await admin.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
  });

  afterAll(async () => {
    await appPrisma?.onModuleDestroy();
    await admin.$disconnect();
  });

  // Fix #2 + #3: a guard-style bypass transaction reads RLS-protected rows and
  // the callback uses the transaction client (`prisma.db`).
  it('runAsSystem bypasses RLS and exposes the transaction client', async () => {
    const result = await uow.runAsSystem(async () => {
      const db = getDb();
      expect(db).not.toBeNull(); // fix #3: ALS points at the tx
      const membership = await appPrisma.db.membership.findFirst({ where: { userId } });
      return { found: !!membership, sameClient: appPrisma.db === db };
    });
    expect(result.found).toBe(true);
    expect(result.sameClient).toBe(true);
  });

  it('runWithTenant scopes to the tenant and sets the tenant GUC', async () => {
    const rows = await uow.runWithTenant(tenantId, async () =>
      appPrisma.db.membership.findMany({ where: { tenantId } })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantId);
  });

  // Fix #4: a nested prisma.transaction reuses the ambient unit-of-work tx.
  it('prisma.transaction reuses the ambient transaction', async () => {
    await runWithRequest({ tenantId }, async () => {
      await appPrisma.transaction(async () => {
        const ambient = getDb();
        await appPrisma.transaction(async () => {
          expect(getDb()).toBe(ambient); // reused, not nested
        });
      });
    });
  });

  it('fails closed without a tenant or system context', async () => {
    await expect(appPrisma.db.membership.findMany({})).rejects.toThrow(/Tenant context required/);
  });
});
