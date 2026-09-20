import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ReportsService } from '../../src/modules/reports/reports.service';
import { ReportsPdfService } from '../../src/modules/reports/reports-pdf.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('reports (Postgres)', () => {
  let h: Harness;
  let reports: ReportsService;
  let pdf: ReportsPdfService;

  beforeAll(async () => {
    h = await createHarness();
    reports = new ReportsService(h.prisma);
    pdf = new ReportsPdfService();
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seed() {
    const tenantId = randomUUID();
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `rpt-${tenantId.slice(0, 8)}`, name: 'Acme Ltd', status: 'approved' } });
    await h.prisma.base.order.create({ data: { id: randomUUID(), tenantId, orderNumber: 'ORD-1', total: '20000.00', status: 'PAID', customerName: 'Asha' } });
    await h.prisma.base.order.create({ data: { id: randomUUID(), tenantId, orderNumber: 'ORD-2', total: '5000.00', status: 'PENDING' } });
    await h.prisma.base.product.create({ data: { id: randomUUID(), tenantId, name: 'Soda', price: '1000.00', stock: 10 } });
    await h.prisma.base.expense.create({ data: { id: randomUUID(), tenantId, description: 'Fuel', amount: '3000.00' } });
    await h.prisma.base.purchase.create({ data: { id: randomUUID(), tenantId, productName: 'Sugar', quantity: 5, costPerUnit: '1000.00', totalCost: '5000.00' } });
    await h.prisma.base.debt.create({ data: { id: randomUUID(), tenantId, customerName: 'Bob', amount: '4000.00', paidAmount: '1000.00' } });
    await h.prisma.base.staff.create({ data: { id: randomUUID(), tenantId, name: 'Sam', email: `sam-${tenantId.slice(0, 6)}@shop.com`, passwordHash: 'x' } });
    return tenantId;
  }

  const withTenant = <T>(t: string, fn: () => Promise<T>) => runWithRequest({ tenantId: t }, fn);

  it('computes summary metrics across all domains', async () => {
    const t = await seed();
    const res = await withTenant(t, () => reports.summary(t, { period: 'all', lang: 'en' } as never));
    expect(res.metrics.orders).toEqual({ count: 2, revenue: 20000 });
    expect(res.metrics.products).toEqual({ count: 1, value: 10000 });
    expect(res.metrics.expenses).toEqual({ count: 1, total: 3000 });
    expect(res.metrics.purchases).toEqual({ count: 1, total: 5000 });
    expect(res.metrics.debts).toEqual({ count: 1, total: 4000, remaining: 3000 });
    expect(res.metrics.staff).toEqual({ count: 1 });
  });

  it('builds every dataset and renders CSV + PDF', async () => {
    const t = await seed();
    const datasets = await withTenant(t, () => reports.build(t, 'full', { period: 'all', lang: 'en' } as never));
    expect(datasets.map((x) => x.title)).toEqual([
      'Expenses Report',
      'Purchases Report',
      'Debts Report',
      'Orders Report',
      'Products Report',
      'Staff Report',
    ]);

    const csv = reports.toCsv(datasets);
    expect(csv).toContain('Expenses Report');
    expect(csv).toContain('Customer');
    expect(csv).toContain('Bob');

    const name = await withTenant(t, () => reports.businessName(t));
    const buffer = await pdf.render(name, 'all', datasets);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
