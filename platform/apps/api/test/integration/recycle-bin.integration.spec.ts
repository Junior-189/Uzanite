import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { RecycleBinService } from '../../src/modules/recycle-bin/recycle-bin.service';
import { OrdersService } from '../../src/modules/commerce/orders.service';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { StockService } from '../../src/modules/catalog/stock.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { LedgerService } from '../../src/modules/finance/ledger.service';
import { ContactsService } from '../../src/modules/contacts/contacts.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('recycle bin (Postgres)', () => {
  let h: Harness;
  let recycle: RecycleBinService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    const stock = new StockService(h.prisma, outbox);
    const billing = new BillingService(h.prisma, h.uow, h.cache, h.config);
    const ledger = new LedgerService(h.prisma);
    const orders = new OrdersService(h.prisma, stock, outbox, billing, ledger);
    const products = new ProductsService(h.prisma, stock, new LocalStorageService(h.config));
    const notifications = new NotificationsService(h.prisma);
    const contacts = new ContactsService(h.prisma, outbox, h.config);
    recycle = new RecycleBinService(h.prisma, orders, products, notifications, contacts);
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

  it('lists soft-deleted products, orders and notifications (tenant-scoped)', async () => {
    const t = await seedTenant('rb-a');
    await h.prisma.base.product.create({ data: { id: randomUUID(), tenantId: t, name: 'P', price: '10', deletedAt: new Date() } });
    await h.prisma.base.order.create({ data: { id: randomUUID(), tenantId: t, orderNumber: 'O1', total: '10', deletedAt: new Date() } });
    await h.prisma.base.notification.create({ data: { id: randomUUID(), tenantId: t, type: 't', title: 'T', message: 'M', deletedAt: new Date() } });
    // A live (non-deleted) product must not appear.
    await h.prisma.base.product.create({ data: { id: randomUUID(), tenantId: t, name: 'Live', price: '10' } });

    const res = await runWithRequest({ tenantId: t }, () => recycle.list(t));
    expect(res.data.products).toHaveLength(1);
    expect(res.data.orders).toHaveLength(1);
    expect(res.data.notifications).toHaveLength(1);
  });

  it('restores a soft-deleted product', async () => {
    const t = await seedTenant('rb-b');
    const id = randomUUID();
    await h.prisma.base.product.create({ data: { id, tenantId: t, name: 'P', price: '10', deletedAt: new Date() } });
    await runWithRequest({ tenantId: t }, () => recycle.restore(t, 'products', id, 'u1'));
    expect((await h.prisma.base.product.findUnique({ where: { id } }))?.deletedAt).toBeNull();
  });

  it('refuses to permanently delete a product with stock history', async () => {
    const t = await seedTenant('rb-c');
    const id = randomUUID();
    await h.prisma.base.product.create({ data: { id, tenantId: t, name: 'P', price: '10', deletedAt: new Date() } });
    await h.prisma.base.stockMovement.create({
      data: { id: randomUUID(), tenantId: t, productId: id, productName: 'P', quantity: 1, balanceAfter: 1, reason: 'restock' },
    });
    await expect(runWithRequest({ tenantId: t }, () => recycle.removePermanent(t, 'products', id, 'u1'))).rejects.toThrow(/history/);
  });

  it('refuses to permanently delete an order with financial records', async () => {
    const t = await seedTenant('rb-d');
    const orderId = randomUUID();
    await h.prisma.base.order.create({ data: { id: orderId, tenantId: t, orderNumber: 'O1', total: '10', deletedAt: new Date() } });
    await h.prisma.base.payment.create({ data: { id: randomUUID(), tenantId: t, orderId, provider: 'manual', method: 'Cash', amount: '10', currency: 'TZS', status: 'succeeded' } });
    await expect(runWithRequest({ tenantId: t }, () => recycle.removePermanent(t, 'orders', orderId, 'u1'))).rejects.toThrow(/financial records/);
  });

  it('permanently deletes a notification', async () => {
    const t = await seedTenant('rb-e');
    const id = randomUUID();
    await h.prisma.base.notification.create({ data: { id, tenantId: t, type: 't', title: 'T', message: 'M', deletedAt: new Date() } });
    await runWithRequest({ tenantId: t }, () => recycle.removePermanent(t, 'notifications', id, 'u1'));
    expect(await h.prisma.base.notification.findUnique({ where: { id } })).toBeNull();
  });
});
