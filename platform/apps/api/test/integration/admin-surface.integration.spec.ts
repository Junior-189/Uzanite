import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { FeatureFlagsService } from '../../src/modules/admin/feature-flags.service';
import { AdminLogsService } from '../../src/modules/admin/admin-logs.service';

const d = hasDb ? describe : describe.skip;

d('admin surface: flags, logs, theme (Postgres)', () => {
  let h: Harness;
  let flags: FeatureFlagsService;
  let logs: AdminLogsService;

  beforeAll(async () => {
    h = await createHarness();
    flags = new FeatureFlagsService(h.prisma, h.cache);
    logs = new AdminLogsService(h.prisma);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seedTenant(label: string) {
    const id = randomUUID();
    await h.prisma.base.tenant.create({ data: { id, slug: `${label}-${id.slice(0, 8)}`, name: label, status: 'approved' } });
    return id;
  }

  it('administers global + tenant feature flags in the legacy keyed shape', async () => {
    const t = await seedTenant('flags');

    const initial = await flags.listForAdmin();
    expect(initial.features.length).toBe(14);
    expect(initial.global.orders).toEqual({ enabled: true, message: '' });

    await flags.updateGlobal({ flags: { orders: { enabled: false, message: 'off' } } } as never);
    expect((await flags.globalMap()).orders).toEqual({ enabled: false, message: 'off' });

    await flags.updateTenant(t, { flags: { reports: { enabled: false, message: 'beta' } } } as never);
    const effective = await flags.effectiveWithMessages(t);
    expect(effective.reports).toEqual({ enabled: false, message: 'beta' });
    expect(effective.orders).toEqual({ enabled: false, message: 'off' });

    const withOverrides = await flags.listForAdmin(t);
    expect(withOverrides.global.reports.overridden).toBe(true);
    expect(withOverrides.global.products.overridden).toBe(false);

    await flags.resetTenant(t);
    const afterReset = await flags.effectiveWithMessages(t);
    expect(afterReset.reports).toEqual({ enabled: true, message: '' });
  });

  it('queries activity logs and summary with user attribution', async () => {
    const t = await seedTenant('logs');
    const userId = randomUUID();
    await h.prisma.base.user.create({ data: { id: userId, email: `u-${userId.slice(0, 6)}@x.com`, name: 'Asha', status: 'active' } });
    for (let i = 0; i < 3; i++) {
      await h.prisma.base.activityLog.create({ data: { tenantId: t, userId, page: 'orders', action: 'visit', device: 'Desktop', browser: 'Chrome' } });
    }

    const page = await logs.activityLogs({ page: 1, limit: 30 } as never);
    expect(page.total).toBe(3);
    expect(page.logs[0].userName).toBe('Asha');
    expect(page.logs[0].page).toBe('orders');

    const summary = await logs.activitySummary();
    expect(summary.totalVisits).toBe(3);
    expect(summary.uniqueVisitors).toBe(1);
    expect(summary.topPages[0]).toEqual({ _id: 'orders', count: 3 });
  });

  it('queries login attempts and summary', async () => {
    const userId = randomUUID();
    await h.prisma.base.user.create({ data: { id: userId, email: `l-${userId.slice(0, 6)}@x.com`, name: 'Bob', platformRole: 'sub_admin', status: 'active' } });
    await h.prisma.base.loginAttempt.create({ data: { email: 'bob@x.com', userId, status: 'success', reason: 'Login successful' } });
    await h.prisma.base.loginAttempt.create({ data: { email: 'bob@x.com', status: 'failed', reason: 'Wrong password' } });

    const failed = await logs.loginAttempts({ page: 1, limit: 30, status: 'failed' } as never);
    expect(failed.total).toBe(1);
    expect(failed.attempts[0].status).toBe('failed');

    const all = await logs.loginAttempts({ page: 1, limit: 30 } as never);
    expect(all.total).toBe(2);
    expect(all.attempts.find((a) => a.status === 'success')?.userName).toBe('Bob');

    const summary = await logs.loginSummary();
    expect(summary.totalAttempts).toBe(2);
    expect(summary.failedEmails).toEqual([{ _id: 'bob@x.com', count: 1 }]);
  });

  it('persists a user theme preference', async () => {
    const userId = randomUUID();
    await h.prisma.base.user.create({ data: { id: userId, email: `t-${userId.slice(0, 6)}@x.com`, name: 'Cara', status: 'active' } });
    const res = await h.auth.setTheme(userId, 'dark');
    expect(res).toEqual({ success: true, theme: 'dark' });
    expect((await h.prisma.base.user.findUnique({ where: { id: userId } }))!.theme).toBe('dark');
  });
});
