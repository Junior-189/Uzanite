import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { StockService } from '../../src/modules/catalog/stock.service';
import { OrdersService } from '../../src/modules/commerce/orders.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { LedgerService } from '../../src/modules/finance/ledger.service';
import { PaymentsService } from '../../src/modules/finance/payments.service';
import { PaymentAdaptersService } from '../../src/modules/finance/payments/payment-adapters.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

async function seedTenant(h: Harness, label: string) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: label, status: 'approved' } });
  await h.prisma.base.user.create({ data: { id: userId, email: `${label}-${tenantId.slice(0, 8)}@x.com`, name: label, status: 'active' } });
  await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
  return tenantId;
}

d('finance integration (Postgres)', () => {
  let h: Harness;
  let products: ProductsService;
  let orders: OrdersService;
  let payments: PaymentsService;
  let ledger: LedgerService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    const stock = new StockService(h.prisma, outbox);
    const uow = new UnitOfWorkService(h.prisma);
    const billing = h.billing;
    ledger = new LedgerService(h.prisma);
    products = new ProductsService(h.prisma, stock, new LocalStorageService(h.config));
    orders = new OrdersService(h.prisma, stock, outbox, billing, ledger);
    payments = new PaymentsService(h.prisma, orders, ledger, outbox, new PaymentAdaptersService());
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  async function approvedOrder(tenantId: string, qty = 2, price = 1000) {
    const p = await withTenant(tenantId, () => products.create(tenantId, { name: 'Item', price, stock: 50, lowStockThreshold: 0 } as never, 'Owner'));
    const created = await withTenant(tenantId, () => orders.create(tenantId, { items: [{ productId: p.product.id, quantity: qty }] } as never, 'Owner'));
    await withTenant(tenantId, () => orders.approve(tenantId, created.order.id, 'ok', 'Owner'));
    return { order: created.order, product: p.product };
  }

  it('manual confirmation writes a succeeded payment, ledger credit, and marks the order PAID', async () => {
    const t = await seedTenant(h, 'fin-a');
    const { order } = await approvedOrder(t, 2, 1500); // total 3000

    const res = await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'M-Pesa', reference: 'TX-1' } as never, 'Owner'));
    expect(res.payment.status).toBe('succeeded');
    expect(Number(res.payment.amount)).toBe(3000);

    const fresh = await h.prisma.base.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('PAID');
    expect(fresh?.paymentReference).toBe('TX-1');

    const entries = await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t, type: 'payment_in' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe('credit');
    expect(Number(entries[0].amount)).toBe(3000);
    expect(entries[0].refId).toBe(res.payment.id);

    const events = await h.prisma.base.outboxEvent.findMany({ where: { tenantId: t } });
    const types = events.map((e) => e.type);
    expect(types).toContain('payment.succeeded');
    expect(types).toContain('order.paid');
  });

  it('is idempotent: replaying a manual confirmation does not double-credit', async () => {
    const t = await seedTenant(h, 'fin-b');
    const { order } = await approvedOrder(t, 1, 2000);

    const first = await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-1' } as never, 'Owner'));
    const second = await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-1' } as never, 'Owner'));

    expect(second.payment.id).toBe(first.payment.id);
    expect(second.idempotent).toBe(true);
    const entries = await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t, type: 'payment_in' } });
    expect(entries).toHaveLength(1);
    expect(await h.prisma.base.payment.count({ where: { tenantId: t } })).toBe(1);
  });

  it('initiates a payment idempotently and records an attempt', async () => {
    const t = await seedTenant(h, 'fin-c');
    const { order } = await approvedOrder(t, 1, 1000);

    const first = await withTenant(t, () => payments.initiate(t, order.id, { provider: 'manual', method: 'manual' } as never, 'Owner'));
    expect(first.payment.status).toBe('pending');
    const second = await withTenant(t, () => payments.initiate(t, order.id, { provider: 'manual', method: 'manual' } as never, 'Owner'));
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.idempotent).toBe(true);

    const attempts = await h.prisma.base.paymentAttempt.findMany({ where: { tenantId: t } });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });

  it('applies a provider webhook result and is idempotent on replay', async () => {
    const t = await seedTenant(h, 'fin-d');
    const { order } = await approvedOrder(t, 1, 4000);

    const paymentId = randomUUID();
    await h.prisma.base.payment.create({
      data: {
        id: paymentId,
        tenantId: t,
        orderId: order.id,
        provider: 'clickpesa',
        method: 'mobile',
        providerRef: 'CP-REF-1',
        amount: '4000',
        currency: 'TZS',
        status: 'pending',
      },
    });

    const applied = await payments.applyProviderResult({
      providerName: 'clickpesa',
      providerRef: 'CP-REF-1',
      status: 'success',
      amount: 4000,
      currency: 'TZS',
    });
    expect(applied.matched).toBe(true);

    const fresh = await h.prisma.base.order.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('PAID');
    const entries = await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t, type: 'payment_in' } });
    expect(entries).toHaveLength(1);

    // Replay -> duplicate, no new ledger entry.
    const replay = await payments.applyProviderResult({ providerName: 'clickpesa', providerRef: 'CP-REF-1', status: 'success', amount: 4000, currency: 'TZS' });
    expect(replay.duplicate).toBe(true);
    expect(await h.prisma.base.ledgerEntry.count({ where: { tenantId: t, type: 'payment_in' } })).toBe(1);
  });

  it('rejects a provider result with a mismatched amount (no credit)', async () => {
    const t = await seedTenant(h, 'fin-e');
    const { order } = await approvedOrder(t, 1, 5000);

    const paymentId = randomUUID();
    await h.prisma.base.payment.create({
      data: { id: paymentId, tenantId: t, orderId: order.id, provider: 'clickpesa', method: 'mobile', providerRef: 'CP-BAD-1', amount: '5000', currency: 'TZS', status: 'pending' },
    });

    await payments.applyProviderResult({ providerName: 'clickpesa', providerRef: 'CP-BAD-1', status: 'success', amount: 100, currency: 'TZS' });

    const payment = await h.prisma.base.payment.findUnique({ where: { id: paymentId } });
    expect(payment?.status).toBe('failed');
    expect(await h.prisma.base.ledgerEntry.count({ where: { tenantId: t, type: 'payment_in' } })).toBe(0);
    expect((await h.prisma.base.order.findUnique({ where: { id: order.id } }))?.status).not.toBe('PAID');
  });

  it('refunds within bounds, writes a debit ledger entry, and is terminal when fully refunded', async () => {
    const t = await seedTenant(h, 'fin-f');
    const { order } = await approvedOrder(t, 1, 3000);
    const confirmed = await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-9' } as never, 'Owner'));
    const paymentId = confirmed.payment.id;

    const partial = await withTenant(t, () => payments.refund(t, paymentId, { amount: 1000, reason: 'partial' } as never, 'Owner'));
    expect(Number(partial.refund.amount)).toBe(1000);
    expect((await h.prisma.base.payment.findUnique({ where: { id: paymentId } }))?.status).toBe('succeeded');

    const debits = await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t, type: 'refund' } });
    expect(debits).toHaveLength(1);
    expect(debits[0].direction).toBe('debit');

    // Over-refund is refused.
    await expect(withTenant(t, () => payments.refund(t, paymentId, { amount: 5000, reason: 'too much' } as never, 'Owner'))).rejects.toThrow(/exceeds/);

    // Full remaining refund flips the payment to refunded (terminal).
    await withTenant(t, () => payments.refund(t, paymentId, { amount: 2000, reason: 'rest' } as never, 'Owner'));
    expect((await h.prisma.base.payment.findUnique({ where: { id: paymentId } }))?.status).toBe('refunded');
    await expect(withTenant(t, () => payments.refund(t, paymentId, { amount: 1, reason: 'x' } as never, 'Owner'))).rejects.toThrow(/exceeds/);
  });

  it('records a cash_sale ledger entry for manual cash orders', async () => {
    const t = await seedTenant(h, 'fin-g');
    const p = await withTenant(t, () => products.create(t, { name: 'CashItem', price: 2500, stock: 5 } as never, 'Owner'));
    await withTenant(t, () => orders.createManual(t, { items: [{ productId: p.product.id, quantity: 2 }] } as never, 'Owner'));

    const entries = await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t, type: 'cash_sale' } });
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].amount)).toBe(5000);
  });

  it('enforces payment immutability and ledger append-only at the database', async () => {
    const t = await seedTenant(h, 'fin-h');
    const { order } = await approvedOrder(t, 1, 1000);
    const confirmed = await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-imm' } as never, 'Owner'));
    const paymentId = confirmed.payment.id;
    const entry = (await h.prisma.base.ledgerEntry.findMany({ where: { tenantId: t } }))[0];

    await expect(h.prisma.base.payment.update({ where: { id: paymentId }, data: { amount: '1' } })).rejects.toThrow(/immutable/);
    await expect(h.prisma.base.ledgerEntry.update({ where: { id: entry.id }, data: { amount: '1' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.base.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
  });

  it('isolates payments and ledger entries between tenants', async () => {
    const a = await seedTenant(h, 'fin-i');
    const b = await seedTenant(h, 'fin-j');
    const { order } = await approvedOrder(a, 1, 1000);
    await withTenant(a, () => payments.confirmManual(a, order.id, { method: 'Cash', reference: 'R-iso' } as never, 'Owner'));

    const listB = await withTenant(b, () => payments.list(b, { limit: 25 } as never));
    expect(listB.payments).toHaveLength(0);
    const ledgerB = await withTenant(b, () => ledger.list(b, { limit: 25 } as never));
    expect(ledgerB.entries).toHaveLength(0);

    const summaryA = await withTenant(a, () => ledger.summary(a));
    expect(summaryA.credit).toBe(1000);
    expect(summaryA.net).toBe(1000);
  });

  it('posts a balanced double-entry journal and reconciles', async () => {
    const t = await seedTenant(h, 'fin-k');
    const { order } = await approvedOrder(t, 2, 1500); // total 3000
    await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-J' } as never, 'Owner'));

    const journals = await h.prisma.base.journalEntry.findMany({ where: { tenantId: t } });
    expect(journals).toHaveLength(1);
    const lines = await h.prisma.base.journalLine.findMany({ where: { tenantId: t } });
    expect(lines).toHaveLength(2);
    const debit = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + Number(l.amount), 0);
    const credit = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + Number(l.amount), 0);
    expect(debit).toBe(3000);
    expect(credit).toBe(3000);

    const rec = await withTenant(t, () => ledger.reconcile(t));
    expect(rec.balanced).toBe(true);
    expect(rec.unbalancedJournals).toBe(0);
    expect(rec.journals).toBe(1);
  });

  it('records a provider payment for an unapproved order without failing the webhook', async () => {
    const t = await seedTenant(h, 'fin-l');
    const p = await withTenant(t, () => products.create(t, { name: 'X', price: 1000, stock: 5 } as never, 'Owner'));
    const created = await withTenant(t, () =>
      orders.create(t, { items: [{ productId: p.product.id, quantity: 1 }] } as never, 'Owner')
    );
    const order = created.order; // still PENDING (not approved)

    const paymentId = randomUUID();
    await h.prisma.base.payment.create({
      data: { id: paymentId, tenantId: t, orderId: order.id, provider: 'clickpesa', method: 'mobile', providerRef: 'CP-UNAPPROVED-1', amount: '1000', currency: 'TZS', status: 'pending' },
    });

    const res = await payments.applyProviderResult({
      providerName: 'clickpesa',
      providerRef: 'CP-UNAPPROVED-1',
      status: 'success',
      amount: 1000,
      currency: 'TZS',
    });
    expect(res.matched).toBe(true);
    expect((await h.prisma.base.payment.findUnique({ where: { id: paymentId } }))?.status).toBe('succeeded');
    expect((await h.prisma.base.order.findUnique({ where: { id: order.id } }))?.status).not.toBe('PAID');
    expect(await h.prisma.base.ledgerEntry.count({ where: { tenantId: t, type: 'payment_in' } })).toBe(1);
    const events = await h.prisma.base.outboxEvent.findMany({ where: { tenantId: t } });
    expect(events.map((e) => e.type)).toContain('payment.awaiting_order_approval');
  });

  it('refuses to permanently delete an order with financial records', async () => {
    const t = await seedTenant(h, 'fin-m');
    const { order } = await approvedOrder(t, 1, 1000);
    await withTenant(t, () => payments.confirmManual(t, order.id, { method: 'Cash', reference: 'R-DEL' } as never, 'Owner'));

    await expect(withTenant(t, () => orders.remove(t, order.id, 'Owner', true))).rejects.toThrow(/Cannot permanently delete/);
    // Soft delete (archive) is still allowed.
    await withTenant(t, () => orders.remove(t, order.id, 'Owner', false));
    expect((await h.prisma.base.order.findUnique({ where: { id: order.id } }))?.deletedAt).toBeTruthy();
  });
});
