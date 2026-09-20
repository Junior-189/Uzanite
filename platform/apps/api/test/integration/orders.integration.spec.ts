import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ProductsService } from '../../src/modules/catalog/products.service';
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

d('orders integration (Postgres)', () => {
  let h: Harness;
  let products: ProductsService;
  let orders: OrdersService;
  let payments: PaymentsService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    const stock = new StockService(h.prisma, outbox);
    const uow = new UnitOfWorkService(h.prisma);
    const billing = h.billing;
    const ledger = new LedgerService(h.prisma);
    products = new ProductsService(h.prisma, stock);
    orders = new OrdersService(h.prisma, stock, outbox, billing, ledger);
    // OrdersService.confirmPayment was removed in M13 because it moved an order
    // to PAID without writing a Payment or ledger entry. Settlement now always
    // goes through Finance, so the test exercises the real path.
    payments = new PaymentsService(h.prisma, orders, ledger, outbox, new PaymentAdaptersService(), h.metrics);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  async function makeProduct(tenantId: string, stock: number, name = 'Widget', price = 1000) {
    const res = await withTenant(tenantId, () => products.create(tenantId, { name, price, stock, lowStockThreshold: 0 } as never, 'Owner'));
    return res.product;
  }

  it('creates an order, computes totals server-side, and deducts stock', async () => {
    const t = await seedTenant(h, 'ord-a');
    const p = await makeProduct(t, 10, 'Soda', 1500);

    const res = await withTenant(t, () =>
      orders.create(t, { customerName: 'Asha', items: [{ productId: p.id, quantity: 3 }] } as never, 'Owner')
    );
    expect(res.order.status).toBe('PENDING');
    expect(Number(res.order.total)).toBe(4500);
    expect(res.order.items).toHaveLength(1);
    expect(Number(res.order.items[0].price)).toBe(1500);
    expect(Number(res.order.items[0].subtotal)).toBe(4500);

    const fresh = await h.prisma.base.product.findUnique({ where: { id: p.id } });
    expect(fresh?.stock).toBe(7);

    const moves = await h.prisma.base.stockMovement.findMany({ where: { tenantId: t, productId: p.id, reason: 'order_created' } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(-3);
    expect(moves[0].balanceAfter).toBe(7);
    expect(moves[0].refId).toBe(res.order.id);

    const created = await h.prisma.base.outboxEvent.findMany({ where: { tenantId: t, type: 'order.created' } });
    expect(created).toHaveLength(1);
  });

  it('honours an offered (negotiated) total while recording the original', async () => {
    const t = await seedTenant(h, 'ord-neg');
    const p = await makeProduct(t, 10, 'Bag', 1000);
    const res = await withTenant(t, () =>
      orders.create(t, { items: [{ productId: p.id, quantity: 2 }], offeredTotal: 1500 } as never, 'Owner')
    );
    expect(Number(res.order.total)).toBe(1500);
    expect(Number(res.order.offeredTotal)).toBe(1500);
    expect(Number(res.order.originalTotal)).toBe(2000);
  });

  it('rejects an offered total below the negotiated minimum', async () => {
    const t = await seedTenant(h, 'ord-min');
    const p = await withTenant(t, () =>
      products.create(t, { name: 'Negotiable', price: 1000, minPrice: 800, stock: 10 } as never, 'Owner')
    ).then((r) => r.product);

    await expect(
      withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 2 }], offeredTotal: 1000 } as never, 'Owner'))
    ).rejects.toThrow(/minimum/);
  });

  it('rejects an offered total above the server-computed total', async () => {
    const t = await seedTenant(h, 'ord-max');
    const p = await makeProduct(t, 10, 'Bag', 1000);

    await expect(
      withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 2 }], offeredTotal: 9999 } as never, 'Owner'))
    ).rejects.toThrow(/cannot exceed/);
  });

  it('rejects a product item price outside [minPrice, price]', async () => {
    const t = await seedTenant(h, 'ord-price');
    const p = await withTenant(t, () =>
      products.create(t, { name: 'Bounded', price: 1000, minPrice: 800, stock: 10 } as never, 'Owner')
    ).then((r) => r.product);

    await expect(
      withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 1, price: 100 }] } as never, 'Owner'))
    ).rejects.toThrow(/between/);
  });

  it('accepts a negotiated total within the allowed range', async () => {
    const t = await seedTenant(h, 'ord-ok');
    const p = await withTenant(t, () =>
      products.create(t, { name: 'Negotiable2', price: 1000, minPrice: 800, stock: 10 } as never, 'Owner')
    ).then((r) => r.product);

    const res = await withTenant(t, () =>
      orders.create(t, { items: [{ productId: p.id, quantity: 2 }], offeredTotal: 1800 } as never, 'Owner')
    );
    expect(Number(res.order.total)).toBe(1800);
  });

  it('rejects an order and restores stock exactly once', async () => {
    const t = await seedTenant(h, 'ord-b');
    const p = await makeProduct(t, 10);
    const created = await withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 4 }] } as never, 'Owner'));

    const rejected = await withTenant(t, () => orders.reject(t, created.order.id, 'Out of area', 'Owner'));
    expect(rejected.order.status).toBe('REJECTED');
    expect(rejected.order.rejectionReason).toBe('Out of area');

    const fresh = await h.prisma.base.product.findUnique({ where: { id: p.id } });
    expect(fresh?.stock).toBe(10);
    const moves = await h.prisma.base.stockMovement.findMany({ where: { tenantId: t, productId: p.id, reason: 'order_rejected' } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantity).toBe(4);

    // Idempotent: a second reject must not double-restore.
    await withTenant(t, () => orders.reject(t, created.order.id, 'again', 'Owner'));
    const after = await h.prisma.base.product.findUnique({ where: { id: p.id } });
    expect(after?.stock).toBe(10);
  });

  it('soft-deletes and restores an order, reversing and re-applying stock', async () => {
    const t = await seedTenant(h, 'ord-c');
    const p = await makeProduct(t, 10);
    const created = await withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 2 }] } as never, 'Owner'));

    await withTenant(t, () => orders.remove(t, created.order.id, 'Owner'));
    expect((await h.prisma.base.product.findUnique({ where: { id: p.id } }))?.stock).toBe(10);

    await withTenant(t, () => orders.restore(t, created.order.id, 'Owner'));
    expect((await h.prisma.base.product.findUnique({ where: { id: p.id } }))?.stock).toBe(8);

    const restored = await withTenant(t, () => orders.get(t, created.order.id));
    expect(restored.order.deletedAt).toBeNull();
    expect(restored.order.status).toBe('PENDING');
  });

  it('prevents overselling and rolls the whole order back', async () => {
    const t = await seedTenant(h, 'ord-d');
    const p = await makeProduct(t, 2);

    await expect(
      withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 5 }] } as never, 'Owner'))
    ).rejects.toThrow(/Insufficient stock/);

    // Stock untouched, and no order persisted (transaction rolled back).
    expect((await h.prisma.base.product.findUnique({ where: { id: p.id } }))?.stock).toBe(2);
    const count = await h.prisma.base.order.count({ where: { tenantId: t } });
    expect(count).toBe(0);
    // Counter increment also rolled back, so the next order starts at 0001.
    const counters = await h.prisma.base.orderCounter.findMany({ where: { tenantId: t } });
    expect(counters.every((c) => c.seq === 0) || counters.length === 0).toBe(true);
  });

  it('generates unique, per-tenant, per-day order numbers', async () => {
    const a = await seedTenant(h, 'ord-e');
    const b = await seedTenant(h, 'ord-f');
    const pa = await makeProduct(a, 100);
    const pb = await makeProduct(b, 100);

    const o1 = await withTenant(a, () => orders.create(a, { items: [{ productId: pa.id, quantity: 1 }] } as never, 'Owner'));
    const o2 = await withTenant(a, () => orders.create(a, { items: [{ productId: pa.id, quantity: 1 }] } as never, 'Owner'));
    const o3 = await withTenant(b, () => orders.create(b, { items: [{ productId: pb.id, quantity: 1 }] } as never, 'Owner'));

    expect(o1.order.orderNumber).toMatch(/^ORD-\d{8}-0001$/);
    expect(o2.order.orderNumber).toMatch(/^ORD-\d{8}-0002$/);
    expect(o1.order.orderNumber).not.toBe(o2.order.orderNumber);
    // Per-tenant sequences are independent.
    expect(o3.order.orderNumber).toMatch(/^ORD-\d{8}-0001$/);
  });

  it('is idempotent on clientRef (no duplicate order or stock deduction)', async () => {
    const t = await seedTenant(h, 'ord-g');
    const p = await makeProduct(t, 10);
    const input = { items: [{ productId: p.id, quantity: 3 }], clientRef: 'offline-123' } as never;

    const first = await withTenant(t, () => orders.create(t, input, 'Owner'));
    const second = await withTenant(t, () => orders.create(t, input, 'Owner'));

    expect(second.order.id).toBe(first.order.id);
    expect(second.idempotent).toBe(true);
    expect((await h.prisma.base.product.findUnique({ where: { id: p.id } }))?.stock).toBe(7);
    expect(await h.prisma.base.order.count({ where: { tenantId: t } })).toBe(1);
    const moves = await h.prisma.base.stockMovement.findMany({ where: { tenantId: t, reason: 'order_created' } });
    expect(moves).toHaveLength(1);
  });

  it('enforces the lifecycle state machine', async () => {
    const t = await seedTenant(h, 'ord-h');
    const p = await makeProduct(t, 10);
    const created = await withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 1 }] } as never, 'Owner'));
    const id = created.order.id;

    // Cannot jump straight to PAID from PENDING.
    await expect(
      withTenant(t, () => payments.confirmManual(t, id, { method: 'Cash', reference: 'ref' } as never, 'Owner'))
    ).rejects.toThrow(/Cannot move/);

    const approved = await withTenant(t, () => orders.approve(t, id, 'ok', 'Owner'));
    expect(approved.order.status).toBe('PENDING_PAYMENT');

    await withTenant(t, () => payments.confirmManual(t, id, { method: 'M-Pesa', reference: 'TX-1' } as never, 'Owner'));
    const paid = await withTenant(t, () => orders.get(t, id));
    expect(paid.order.status).toBe('PAID');
    expect(paid.order.paymentReference).toBe('TX-1');

    const delivered = await withTenant(t, () => orders.deliver(t, id, 'handed over', 'Owner'));
    expect(delivered.order.status).toBe('DELIVERED');

    const history = await withTenant(t, () => orders.history(t, id));
    expect(history.history.map((x) => x.status)).toEqual(['PENDING', 'APPROVED', 'PENDING_PAYMENT', 'PAID', 'DELIVERED']);
  });

  it('creates a manual cash order as PAID + DELIVERED and deducts stock', async () => {
    const t = await seedTenant(h, 'ord-i');
    const p = await makeProduct(t, 10);
    const res = await withTenant(t, () => orders.createManual(t, { customerName: 'Walk-in', items: [{ productId: p.id, quantity: 2 }] } as never, 'Owner'));

    expect(res.order.source).toBe('cash');
    expect(res.order.status).toBe('PAID');
    expect(res.order.deliveredAt).toBeTruthy();
    expect((await h.prisma.base.product.findUnique({ where: { id: p.id } }))?.stock).toBe(8);
    const paid = await h.prisma.base.outboxEvent.findMany({ where: { tenantId: t, type: 'order.paid' } });
    expect(paid).toHaveLength(1);
  });

  it('isolates orders between tenants', async () => {
    const a = await seedTenant(h, 'ord-j');
    const b = await seedTenant(h, 'ord-k');
    const pa = await makeProduct(a, 10);
    const created = await withTenant(a, () => orders.create(a, { items: [{ productId: pa.id, quantity: 1 }] } as never, 'Owner'));

    const listB = await withTenant(b, () => orders.list(b, { limit: 25 } as never));
    expect(listB.orders).toHaveLength(0);
    await expect(withTenant(b, () => orders.get(b, created.order.id))).rejects.toThrow(/not found/);
  });

  it('paginates orders by keyset', async () => {
    const t = await seedTenant(h, 'ord-l');
    const p = await makeProduct(t, 100);
    for (let i = 0; i < 5; i++) {
      await withTenant(t, () => orders.create(t, { items: [{ productId: p.id, quantity: 1 }] } as never, 'Owner'));
    }
    const page1 = await withTenant(t, () => orders.list(t, { limit: 2 } as never));
    expect(page1.orders).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await withTenant(t, () => orders.list(t, { limit: 2, cursor: page1.nextCursor } as never));
    const ids = new Set(page1.orders.map((o) => o.id));
    expect(page2.orders.every((o) => !ids.has(o.id))).toBe(true);
  });
});
