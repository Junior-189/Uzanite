import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ExpensesService } from '../../src/modules/ledgers/expenses.service';
import { PurchasesService } from '../../src/modules/ledgers/purchases.service';
import { DebtsService } from '../../src/modules/ledgers/debts.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('finance ledgers (Postgres)', () => {
  let h: Harness;
  let expenses: ExpensesService;
  let purchases: PurchasesService;
  let debts: DebtsService;

  beforeAll(async () => {
    h = await createHarness();
    expenses = new ExpensesService(h.prisma);
    purchases = new PurchasesService(h.prisma, new LocalStorageService(h.config));
    debts = new DebtsService(h.prisma, h.outbox);
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

  const withTenant = <T>(t: string, fn: () => Promise<T>) => runWithRequest({ tenantId: t }, fn);
  const owner = () =>
    ({ userId: randomUUID(), name: 'Owner', role: 'owner', platformRole: null, tenantId: null, membershipId: null, permissions: [], tokenVersion: 0, impersonatedBy: null }) as never;

  it('creates, lists (with totals) and deletes expenses', async () => {
    const t = await seedTenant('exp');
    await withTenant(t, () => expenses.create(t, { description: 'Fuel', amount: 5000, category: 'Transport' } as never, owner()));
    await withTenant(t, () => expenses.create(t, { description: 'Rent', amount: 20000 } as never, owner()));

    const list = await withTenant(t, () => expenses.list(t, { limit: 100 } as never));
    expect(list.count).toBe(2);
    expect(list.total).toBe(25000);
    expect(list.expenses[0]._id).toBeDefined();

    await withTenant(t, () => expenses.remove(t, list.expenses[0]._id));
    expect((await withTenant(t, () => expenses.list(t, { limit: 100 } as never))).count).toBe(1);
  });

  it('creates purchases idempotently, updates, signs receipts and soft-deletes', async () => {
    const t = await seedTenant('pur');
    const ref = randomUUID();
    const first = await withTenant(t, () =>
      purchases.create(t, { productName: 'Sugar', quantity: 10, costPerUnit: 1500, clientRef: ref, receiptKey: 'k1.png' } as never, owner())
    );
    expect(first.purchase.totalCost).toBe(15000);
    expect(first.purchase.receiptPath).toContain('/api/v1/files/');

    const replay = await withTenant(t, () =>
      purchases.create(t, { productName: 'Sugar', quantity: 10, costPerUnit: 1500, clientRef: ref } as never, owner())
    );
    expect(replay.purchase._id).toBe(first.purchase._id);

    const withFile = await withTenant(t, () =>
      purchases.create(t, { productName: 'Oil', quantity: 2, costPerUnit: 500 } as never, owner(), { buffer: Buffer.from('pdf-bytes'), originalname: 'r.pdf' })
    );
    expect(withFile.purchase.receiptPath).toContain('/api/v1/files/');

    const updated = await withTenant(t, () => purchases.update(t, first.purchase._id, { quantity: 20, costPerUnit: 2000 } as never));
    expect(updated.purchase.totalCost).toBe(40000);

    const list = await withTenant(t, () => purchases.list(t, { limit: 100 } as never));
    expect(list.count).toBe(2);
    expect(list.totalCost).toBe(41000);

    await withTenant(t, () => purchases.remove(t, first.purchase._id, randomUUID()));
    expect((await withTenant(t, () => purchases.list(t, { limit: 100 } as never))).count).toBe(1);
  });

  it('manages debts: totals, partial/full payment and reminders', async () => {
    const t = await seedTenant('debt');
    const created = await withTenant(t, () =>
      debts.create(t, { customerName: 'Asha', customerPhone: '255700000000', amount: 10000 } as never, owner())
    );
    expect(created.debt.status).toBe('unpaid');

    const partial = await withTenant(t, () => debts.pay(t, created.debt._id, { paymentAmount: 4000 } as never));
    expect(partial.debt.status).toBe('partial');
    expect(partial.remaining).toBe(6000);

    const full = await withTenant(t, () => debts.pay(t, created.debt._id, { paymentAmount: 6000 } as never));
    expect(full.debt.status).toBe('paid');
    expect(full.remaining).toBe(0);

    const created2 = await withTenant(t, () => debts.create(t, { customerName: 'Bob', amount: 5000 } as never, owner()));
    const list = await withTenant(t, () => debts.list(t, { status: 'all', limit: 100 } as never));
    expect(list.count).toBe(2);
    expect(list.totalDebt).toBe(15000);
    expect(list.totalUnpaid).toBe(5000);

    await expect(withTenant(t, () => debts.reminder(t, created2.debt._id))).rejects.toThrow(/phone/i);
    const withPhone = await withTenant(t, () => debts.create(t, { customerName: 'Cara', customerPhone: '255711111111', amount: 1000 } as never, owner()));
    await withTenant(t, () => debts.reminder(t, withPhone.debt._id));
    const all = await withTenant(t, () => debts.reminderAll(t));
    expect(all.accepted).toBe(true);
    const event = await h.prisma.base.outboxEvent.findFirst({ where: { tenantId: t, type: 'debt.reminder' } });
    expect(event).toBeTruthy();

    await withTenant(t, () => debts.remove(t, created.debt._id, randomUUID()));
    expect((await withTenant(t, () => debts.list(t, { status: 'all', limit: 100 } as never))).count).toBe(2);
  });
});
