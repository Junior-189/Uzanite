import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

async function seedTwoTenants(h: Harness) {
  const a = randomUUID();
  const b = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  await h.prisma.base.tenant.createMany({
    data: [
      { id: a, slug: `a-${a.slice(0, 8)}`, name: 'A', status: 'approved' },
      { id: b, slug: `b-${b.slice(0, 8)}`, name: 'B', status: 'approved' },
    ],
  });
  await h.prisma.base.user.createMany({
    data: [
      { id: userA, email: `a-${a.slice(0, 8)}@x.com`, name: 'A', status: 'active' },
      { id: userB, email: `b-${b.slice(0, 8)}@x.com`, name: 'B', status: 'active' },
    ],
  });
  await h.prisma.base.membership.createMany({
    data: [
      { id: randomUUID(), userId: userA, tenantId: a, role: 'owner' },
      { id: randomUUID(), userId: userB, tenantId: b, role: 'owner' },
    ],
  });
  return { a, b };
}

d('tenant isolation via Prisma extension (Postgres)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  it('scopes reads to the active tenant', async () => {
    const { a } = await seedTwoTenants(h);
    const rows = await runWithRequest({ tenantId: a }, async () => h.prisma.db.membership.findMany({}));
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(a);
  });

  it('cannot read another tenant even if the filter asks for it', async () => {
    const { a, b } = await seedTwoTenants(h);
    const rows = await runWithRequest({ tenantId: a }, async () =>
      h.prisma.db.membership.findMany({ where: { tenantId: b } })
    );
    expect(rows.every((r) => r.tenantId === a)).toBe(true);
  });

  it('fails closed without a tenant or system context', async () => {
    await expect(h.prisma.db.membership.findMany({})).rejects.toThrow(/Tenant context required/);
  });
});
