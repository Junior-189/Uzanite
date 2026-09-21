import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('dashboard (Postgres)', () => {
  let h: Harness;
  let dashboard: DashboardService;

  beforeAll(async () => {
    h = await createHarness();
    dashboard = new DashboardService(h.prisma);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seedTenant(label: string) {
    const id = randomUUID();
    await h.prisma.base.tenant.create({
      data: { id, slug: `${label}-${id.slice(0, 8)}`, name: label, status: 'approved' },
    });
    return id;
  }

  it('aggregates tenant order counters and revenue', async () => {
    const t = await seedTenant('dash-a');
    await h.prisma.base.order.createMany({
      data: [
        { id: randomUUID(), tenantId: t, orderNumber: 'O1', total: '100', status: 'PENDING' },
        { id: randomUUID(), tenantId: t, orderNumber: 'O2', total: '200', status: 'APPROVED' },
        { id: randomUUID(), tenantId: t, orderNumber: 'O3', total: '300', status: 'PAID', source: 'cash', paymentMethod: 'Cash' },
        { id: randomUUID(), tenantId: t, orderNumber: 'O4', total: '400', status: 'DELIVERED', paymentMethod: 'M-Pesa' },
        { id: randomUUID(), tenantId: t, orderNumber: 'O5', total: '50', status: 'REJECTED' },
      ],
    });
    await h.prisma.base.product.create({ data: { id: randomUUID(), tenantId: t, name: 'P', price: '10' } });

    const res = await runWithRequest({ tenantId: t }, () => dashboard.stats(t, { period: 'all' } as never));
    expect(res.stats.totalOrders).toBe(5);
    expect(res.stats.pendingOrders).toBe(1);
    expect(res.stats.approvedOrders).toBe(1);
    expect(res.stats.rejectedOrders).toBe(1);
    expect(res.stats.paidOrders).toBe(2); // PAID + DELIVERED
    expect(res.stats.deliveredOrders).toBe(1);
    expect(res.stats.revenue).toBe(700);
    expect(res.stats.cashOrders).toBe(1);
    expect(res.stats.onlineOrders).toBe(1);
    expect(res.stats.totalProducts).toBe(1);
  });

  it('isolates tenants', async () => {
    const a = await seedTenant('dash-b');
    const b = await seedTenant('dash-c');
    await h.prisma.base.order.create({
      data: { id: randomUUID(), tenantId: a, orderNumber: 'OA', total: '100', status: 'PAID' },
    });
    const res = await runWithRequest({ tenantId: b }, () => dashboard.stats(b, { period: 'all' } as never));
    expect(res.stats.totalOrders).toBe(0);
  });
});
