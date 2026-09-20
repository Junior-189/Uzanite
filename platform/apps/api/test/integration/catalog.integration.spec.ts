import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { StockService } from '../../src/modules/catalog/stock.service';
import { OutboxService } from '../../src/outbox/outbox.service';
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

d('catalog integration (Postgres)', () => {
  let h: Harness;
  let products: ProductsService;
  let stock: StockService;
  let outbox: OutboxService;

  beforeAll(async () => {
    h = await createHarness();
    outbox = new OutboxService(h.prisma);
    stock = new StockService(h.prisma, outbox);
    products = new ProductsService(h.prisma, stock, new LocalStorageService(h.config));
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  it('creates a product with an initial stock movement and consistent balance', async () => {
    const t = await seedTenant(h, 'cat-a');
    const res = await withTenant(t, () =>
      products.create(t, { name: 'Soda', price: 1000, stock: 10, lowStockThreshold: 3 } as never, 'Owner')
    );
    expect(Number(res.product.stock)).toBe(10);

    const moves = await withTenant(t, () => products.movements(t, res.product.id));
    expect(moves.movements).toHaveLength(1);
    expect(moves.movements[0].quantity).toBe(10);
    expect(moves.movements[0].balanceAfter).toBe(10);
  });

  it('serializes legacy-compatible product fields (_id + signed imagePath)', async () => {
    const t = await seedTenant(h, 'cat-img');
    const created = await withTenant(t, () =>
      products.create(t, { name: 'Tea', price: 500, imageKey: 'k1.png' } as never, 'Owner')
    );
    expect(created.product._id).toBe(created.product.id);
    expect(created.product.imagePath).toContain('/api/v1/files/');

    const got = await withTenant(t, () => products.get(t, created.product.id));
    expect(got.product._id).toBe(created.product.id);
    expect(got.product.imagePath).toContain('sig=');
  });

  it('restocks and adjusts, and refuses to go negative', async () => {
    const t = await seedTenant(h, 'cat-b');
    const created = await withTenant(t, () =>
      products.create(t, { name: 'Milk', price: 2000, stock: 10, lowStockThreshold: 3 } as never, 'Owner')
    );
    const id = created.product.id;

    const afterRestock = await withTenant(t, () => products.restock(t, id, { quantity: 5 } as never, 'Owner'));
    expect(Number(afterRestock.product.stock)).toBe(15);

    await expect(withTenant(t, () => products.adjust(t, id, { delta: -100 } as never, 'Owner'))).rejects.toThrow(/Insufficient stock/);

    const afterAdjust = await withTenant(t, () => products.adjust(t, id, { delta: -5 } as never, 'Owner'));
    expect(afterAdjust.product.stock).toBe(10);

    // Ledger must equal the balance.
    const moves = await withTenant(t, () => products.movements(t, id));
    const sum = moves.movements.reduce((s, m) => s + m.quantity, 0);
    expect(sum).toBe(10);
  });

  it('enforces barcode uniqueness per tenant but not across tenants', async () => {
    const a = await seedTenant(h, 'cat-c');
    const b = await seedTenant(h, 'cat-d');
    await withTenant(a, () => products.create(a, { name: 'A', price: 1, barcode: 'BAR-1' } as never, 'Owner'));

    await expect(
      withTenant(a, () => products.create(a, { name: 'A2', price: 1, barcode: 'BAR-1' } as never, 'Owner'))
    ).rejects.toThrow(/barcode/);

    // Same barcode is fine for a different tenant.
    const other = await withTenant(b, () => products.create(b, { name: 'B', price: 1, barcode: 'BAR-1' } as never, 'Owner'));
    expect(other.product.barcode).toBe('BAR-1');
  });

  it('isolates products between tenants', async () => {
    const a = await seedTenant(h, 'cat-e');
    const b = await seedTenant(h, 'cat-f');
    const pa = await withTenant(a, () => products.create(a, { name: 'OnlyA', price: 1 } as never, 'Owner'));
    await withTenant(b, () => products.create(b, { name: 'OnlyB', price: 1 } as never, 'Owner'));

    const listA = await withTenant(a, () => products.list(a, { limit: 25 } as never));
    expect(listA.products.map((p: { name: string }) => p.name)).toEqual(['OnlyA']);

    // Cannot read tenant A's product while in tenant B's context.
    const fetched = await withTenant(b, () => products.list(b, { limit: 25 } as never));
    expect(fetched.products.find((p: { id: string }) => p.id === pa.product.id)).toBeUndefined();
  });

  it('paginates products by keyset', async () => {
    const t = await seedTenant(h, 'cat-g');
    for (let i = 0; i < 5; i++) {
      await withTenant(t, () => products.create(t, { name: `P${i}`, price: 1 } as never, 'Owner'));
    }
    const p1 = await withTenant(t, () => products.list(t, { limit: 2 } as never));
    expect(p1.products).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await withTenant(t, () => products.list(t, { limit: 2, cursor: p1.nextCursor } as never));
    const ids1 = new Set(p1.products.map((p: { id: string }) => p.id));
    expect(p2.products.every((p: { id: string }) => !ids1.has(p.id))).toBe(true);
  });

  it('emits a low_stock outbox event when stock crosses the threshold', async () => {
    const t = await seedTenant(h, 'cat-h');
    await withTenant(t, () => products.create(t, { name: 'LowItem', price: 1, stock: 2, lowStockThreshold: 5 } as never, 'Owner'));
    const events = await h.prisma.base.outboxEvent.findMany({ where: { type: 'product.low_stock' } });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
