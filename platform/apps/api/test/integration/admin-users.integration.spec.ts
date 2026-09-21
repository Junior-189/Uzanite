import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { decryptPii } from '../../src/security/pii';
import { AdminUsersService } from '../../src/modules/admin/admin-users.service';
import { FeatureFlagsService } from '../../src/modules/admin/feature-flags.service';

const d = hasDb ? describe : describe.skip;

d('admin users (Postgres)', () => {
  let h: Harness;
  let admin: AdminUsersService;

  beforeAll(async () => {
    h = await createHarness();
    admin = new AdminUsersService(h.prisma, h.tokens, h.config, h.cache, new FeatureFlagsService(h.prisma, h.cache));
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seedBusiness(label: string, tenantStatus: 'pending' | 'approved' | 'rejected' = 'approved') {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: `${label} Ltd`, status: tenantStatus } });
    await h.prisma.base.user.create({ data: { id: userId, email: `${label}-${userId.slice(0, 8)}@shop.com`, name: label, status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner', permissions: [] } });
    await h.prisma.base.subscription.create({ data: { id: randomUUID(), tenantId, planKey: 'free', status: 'active' } });
    return { tenantId, userId };
  }

  it('lists tenant accounts with per-business counts', async () => {
    const { tenantId, userId } = await seedBusiness('acme');
    await h.prisma.base.order.create({ data: { id: randomUUID(), tenantId, orderNumber: 'A-1', total: '1500.00', status: 'PAID' } });
    await h.prisma.base.product.create({ data: { id: randomUUID(), tenantId, name: 'Soda', price: '1000.00' } });
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId, phone: '255700000001' } });

    const res = await admin.listUsers();
    expect(res.success).toBe(true);
    expect(res.counts.total).toBe(1);
    expect(res.counts.approved).toBe(1);
    const row = res.users.find((u) => u._id === userId)!;
    expect(row.businessName).toBe('acme Ltd');
    expect(row.businessId).toBe(tenantId);
    expect(row.plan).toBe('free');
    expect(row.totalOrders).toBe(1);
    expect(row.totalRevenue).toBe(1500);
    expect(row.productCount).toBe(1);
    expect(row.contactCount).toBe(1);
  });

  it('reports stats', async () => {
    await seedBusiness('s1', 'pending');
    await seedBusiness('s2', 'approved');
    const res = await admin.stats();
    expect(res.stats.totalUsers).toBe(2);
    expect(res.stats.pendingUsers).toBe(1);
    expect(res.stats.approvedUsers).toBe(1);
  });

  it('approves, rejects and suspends a tenant account', async () => {
    const { userId, tenantId } = await seedBusiness('flow', 'pending');
    await admin.approve(userId);
    expect((await h.prisma.base.tenant.findUnique({ where: { id: tenantId } }))!.status).toBe('approved');

    await admin.reject(userId, { reason: 'incomplete' } as never);
    const rejected = await h.prisma.base.tenant.findUnique({ where: { id: tenantId } });
    expect(rejected!.status).toBe('rejected');
    expect(rejected!.rejectionReason).toBe('incomplete');

    await admin.suspend(userId, true);
    expect((await h.prisma.base.tenant.findUnique({ where: { id: tenantId } }))!.status).toBe('suspended');
    await admin.suspend(userId, false);
    expect((await h.prisma.base.tenant.findUnique({ where: { id: tenantId } }))!.status).toBe('approved');
  });

  it('updates name/email and resets the password (revoking sessions)', async () => {
    const { userId } = await seedBusiness('edit');
    await admin.updateName(userId, 'New Name');
    await admin.updateEmail(userId, 'new@shop.com');
    const afterEdit = await h.prisma.base.user.findUnique({ where: { id: userId } });
    expect(afterEdit!.name).toBe('New Name');
    expect(decryptPii(afterEdit!.email)).toBe('new@shop.com');

    const before = afterEdit!.tokenVersion;
    const res = await admin.resetPassword(userId, 'brandnew123');
    expect(res.sessionsRevoked).toBe(true);
    const after = await h.prisma.base.user.findUnique({ where: { id: userId } });
    expect(after!.tokenVersion).toBe(before + 1);
    expect(after!.mustChangePassword).toBe(true);
    expect(after!.passwordHash).not.toBe('brandnew123');
  });

  it('soft-deletes then permanently deletes an account', async () => {
    const { userId } = await seedBusiness('del');
    await admin.remove(userId, false);
    expect((await h.prisma.base.user.findUnique({ where: { id: userId } }))!.deletedAt).not.toBeNull();
    expect((await admin.listUsers()).counts.total).toBe(0);

    await admin.remove(userId, true);
    expect(await h.prisma.base.user.count({ where: { id: userId } })).toBe(0);
  });

  it('impersonates an approved tenant owner with page permissions', async () => {
    const { userId, tenantId } = await seedBusiness('imp');
    const actorId = randomUUID();
    await h.prisma.base.user.create({ data: { id: actorId, email: 'super@uzanite.com', name: 'Super', platformRole: 'super_admin', status: 'active' } });

    const res = await admin.impersonate(userId, actorId, '127.0.0.1', 'vitest');
    expect(res.success).toBe(true);
    expect(typeof res.token).toBe('string');
    expect(res.user._id).toBe(userId);
    expect(res.user.businessId).toBe(tenantId);
    expect(res.impersonation.active).toBe(true);
    expect(res.impersonation.pagePermissions.length).toBeGreaterThan(0);
  });

  it('manages sub-admins', async () => {
    const created = await admin.createSubAdmin({ name: 'Sub', email: 'sub@uzanite.com', password: 'secret123', permissions: ['view_tenants'] } as never);
    expect(created.user.platformRole).toBe('sub_admin');
    expect(created.user.permissions).toEqual(['view_tenants']);

    const list = await admin.listSubAdmins();
    expect(list.users).toHaveLength(1);
    expect(list.permissions.view_tenants).toBe('View tenants');

    await admin.updateSubAdmin(created.user.id, { permissions: ['view_tenants', 'approve_tenants'] } as never);
    const updated = await h.prisma.base.user.findUnique({ where: { id: created.user.id } });
    expect(updated!.permissions).toEqual(['view_tenants', 'approve_tenants']);

    await admin.resetSubAdminPassword(created.user.id, 'another123');
    expect((await h.prisma.base.user.findUnique({ where: { id: created.user.id } }))!.mustChangePassword).toBe(true);

    await admin.removeSubAdmin(created.user.id);
    expect(await h.prisma.base.user.count({ where: { id: created.user.id } })).toBe(0);
  });
});
