import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ReceiptsService } from '../../src/modules/receipts/receipts.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('notifications & receipts integration (Postgres)', () => {
  let h: Harness;
  let notifications: NotificationsService;
  let receipts: ReceiptsService;

  beforeAll(async () => {
    h = await createHarness();
    notifications = new NotificationsService(h.prisma);
    receipts = new ReceiptsService(h.prisma);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    const userId = randomUUID();
    await h.prisma.base.tenant.create({
      data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: `${label} Ltd`, status: 'approved' },
    });
    await h.prisma.base.user.create({
      data: { id: userId, email: `${label}-${tenantId.slice(0, 8)}@x.com`, name: label, status: 'active' },
    });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
    return { tenantId, userId };
  }

  async function seedOrder(tenantId: string, orderNumber = 'ORD-N1') {
    const orderId = randomUUID();
    await h.prisma.base.order.create({
      data: {
        id: orderId,
        tenantId,
        orderNumber,
        total: '3000',
        currency: 'TZS',
        status: 'PAID',
        customerName: 'Asha',
        customerEmail: 'asha@example.com',
        customerPhone: '+255700000000',
      },
    });
    await h.prisma.base.orderItem.create({
      data: { id: randomUUID(), tenantId, orderId, productName: 'Soda', price: '1500', currency: 'TZS', quantity: 2, subtotal: '3000' },
    });
    return orderId;
  }

  async function seedNotification(tenantId: string, type: string, read = false, dedupeKey?: string) {
    const id = randomUUID();
    await h.prisma.base.notification.create({
      data: { id, tenantId, type, title: type, message: `${type} message`, read, dedupeKey: dedupeKey ?? null },
    });
    return id;
  }

  it('lists notifications with unread count and keyset pagination', async () => {
    const { tenantId } = await seedTenant('ntf-a');
    for (let i = 0; i < 3; i++) await seedNotification(tenantId, 'order_paid', i === 0);

    const page = await withTenant(tenantId, () => notifications.list(tenantId, { limit: 2 } as never));
    expect(page.notifications).toHaveLength(2);
    expect(page.unreadCount).toBe(2);
    expect(page.nextCursor).toBeTruthy();
    const page2 = await withTenant(tenantId, () => notifications.list(tenantId, { limit: 2, cursor: page.nextCursor } as never));
    expect(page2.notifications).toHaveLength(1);
  });

  it('marks one and all notifications read, and reports unread count', async () => {
    const { tenantId } = await seedTenant('ntf-b');
    const n1 = await seedNotification(tenantId, 'order_paid');
    await seedNotification(tenantId, 'low_stock');

    await withTenant(tenantId, () => notifications.markRead(tenantId, n1));
    expect(await withTenant(tenantId, () => notifications.unreadCount(tenantId))).toBe(1);

    await withTenant(tenantId, () => notifications.markAllRead(tenantId));
    expect(await withTenant(tenantId, () => notifications.unreadCount(tenantId))).toBe(0);
  });

  it('soft-deletes, restores, and permanently deletes notifications', async () => {
    const { tenantId, userId } = await seedTenant('ntf-c');
    const id = await seedNotification(tenantId, 'order_paid');

    await withTenant(tenantId, () => notifications.remove(tenantId, id, userId));
    const list = await withTenant(tenantId, () => notifications.list(tenantId, { limit: 25 } as never));
    expect(list.notifications).toHaveLength(0);

    await withTenant(tenantId, () => notifications.restore(tenantId, id));
    const restored = await withTenant(tenantId, () => notifications.list(tenantId, { limit: 25 } as never));
    expect(restored.notifications).toHaveLength(1);

    await withTenant(tenantId, () => notifications.remove(tenantId, id, userId, true));
    await expect(withTenant(tenantId, () => notifications.get(tenantId, id))).rejects.toThrow(/not found/);
  });

  it('isolates notifications between tenants', async () => {
    const a = await seedTenant('ntf-d');
    const b = await seedTenant('ntf-e');
    await seedNotification(a.tenantId, 'order_paid');

    const listB = await withTenant(b.tenantId, () => notifications.list(b.tenantId, { limit: 25 } as never));
    expect(listB.notifications).toHaveLength(0);
    expect(listB.unreadCount).toBe(0);
  });

  it('generates an idempotent structured order receipt and renders HTML', async () => {
    const { tenantId } = await seedTenant('rcp-a');
    const orderId = await seedOrder(tenantId, 'ORD-RCP-1');

    const first = await withTenant(tenantId, () => receipts.generateForOrder(tenantId, orderId));
    expect(first.receipt.receiptNumber).toBe('RCP-ORD-RCP-1');
    expect(Number(first.receipt.amount)).toBe(3000);
    const data = first.receipt.data as { order: { number: string }; order_items?: unknown; totals: { total: number } };
    expect(data.order.number).toBe('ORD-RCP-1');
    expect(data.totals.total).toBe(3000);

    const second = await withTenant(tenantId, () => receipts.generateForOrder(tenantId, orderId));
    expect(second.idempotent).toBe(true);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(await h.prisma.base.receipt.count({ where: { tenantId } })).toBe(1);

    const byOrder = await withTenant(tenantId, () => receipts.getByOrder(tenantId, orderId));
    expect(byOrder.receipt.id).toBe(first.receipt.id);

    const html = await withTenant(tenantId, () => receipts.renderHtml(tenantId, first.receipt.id));
    expect(html).toContain('ORD-RCP-1');
    expect(html).toContain('Soda');
    expect(html).toContain('3,000.00');
  });

  it('isolates receipts between tenants', async () => {
    const a = await seedTenant('rcp-b');
    const b = await seedTenant('rcp-c');
    const orderId = await seedOrder(a.tenantId);
    await withTenant(a.tenantId, () => receipts.generateForOrder(a.tenantId, orderId));

    const listB = await withTenant(b.tenantId, () => receipts.list(b.tenantId, { limit: 25 } as never));
    expect(listB.receipts).toHaveLength(0);
    await expect(withTenant(b.tenantId, () => receipts.getByOrder(b.tenantId, orderId))).rejects.toThrow(/not found/);
  });
});
