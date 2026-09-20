import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { hasDb, resetDb } from './setup';
import { EmailService } from '../src/email.service';
import { NotificationWriter } from '../src/consumers/notification-writer.service';
import { ReceiptWriter } from '../src/consumers/receipt-writer.service';
import { OutboxDispatcherService } from '../src/consumers/outbox-dispatcher.service';
import { OutboxPublisherService } from '../src/outbox-publisher.service';

const d = hasDb ? describe : describe.skip;

d('outbox consumers (worker, Postgres)', () => {
  let prisma: PrismaClient;
  let dispatcher: OutboxDispatcherService;
  let publisher: OutboxPublisherService;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    const email = new EmailService(new ConfigService());
    // WhatsApp outbound is exercised in its own spec; a stub is enough here.
    const whatsapp = { enqueue: async () => null } as never;
    dispatcher = new OutboxDispatcherService(new NotificationWriter(), new ReceiptWriter(), email, whatsapp);
    publisher = new OutboxPublisherService(dispatcher);
  });
  afterAll(async () => {
    // Close the publisher's own client too, so no connection lingers into the
    // next workspace package's tests.
    await publisher.onApplicationShutdown();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function dispatchInSystem(type: string, tenantId: string, payload: Record<string, unknown>, id = randomUUID()) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await dispatcher.dispatch({ id, tenantId, type, payload, attempts: 0 }, tx);
    });
  }

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: `${label} Ltd`, status: 'approved' } });
    return tenantId;
  }

  async function seedOrder(tenantId: string, orderNumber: string) {
    const orderId = randomUUID();
    await prisma.order.create({
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
    await prisma.orderItem.create({
      data: { id: randomUUID(), tenantId, orderId, productName: 'Soda', price: '1500', currency: 'TZS', quantity: 2, subtotal: '3000' },
    });
    return orderId;
  }

  it('order.paid creates a notification and an order receipt, idempotently', async () => {
    const tenantId = await seedTenant('w-a');
    const orderId = await seedOrder(tenantId, 'ORD-W-1');

    await dispatchInSystem('order.paid', tenantId, { orderId, method: 'Cash', reference: 'R1' });
    expect(await prisma.notification.count({ where: { tenantId, type: 'order_paid' } })).toBe(1);
    const receipts = await prisma.receipt.findMany({ where: { tenantId, orderId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptNumber).toBe('RCP-ORD-W-1');

    // Replay (at-least-once delivery) must not duplicate.
    await dispatchInSystem('order.paid', tenantId, { orderId, method: 'Cash', reference: 'R1' });
    expect(await prisma.notification.count({ where: { tenantId, type: 'order_paid' } })).toBe(1);
    expect(await prisma.receipt.count({ where: { tenantId, orderId } })).toBe(1);
  });

  it('payment.succeeded creates a payment_confirmed notification and a payment receipt', async () => {
    const tenantId = await seedTenant('w-b');
    const orderId = await seedOrder(tenantId, 'ORD-W-2');
    const paymentId = randomUUID();
    await prisma.payment.create({
      data: {
        id: paymentId,
        tenantId,
        orderId,
        provider: 'manual',
        method: 'M-Pesa',
        amount: '3000',
        currency: 'TZS',
        status: 'succeeded',
        confirmedAt: new Date(),
      },
    });

    await dispatchInSystem('payment.succeeded', tenantId, { paymentId, orderId, amount: 3000, currency: 'TZS', provider: 'manual' });
    expect(await prisma.notification.count({ where: { tenantId, type: 'payment_confirmed' } })).toBe(1);
    const receipts = await prisma.receipt.findMany({ where: { tenantId, paymentId } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].type).toBe('payment');
  });

  it('emits a low_stock notification per threshold crossing', async () => {
    const tenantId = await seedTenant('w-c');
    const productId = randomUUID();
    await dispatchInSystem('product.low_stock', tenantId, { productId, name: 'Soda', stock: 2, threshold: 5 }, randomUUID());
    await dispatchInSystem('product.low_stock', tenantId, { productId, name: 'Soda', stock: 1, threshold: 5 }, randomUUID());
    expect(await prisma.notification.count({ where: { tenantId, type: 'low_stock' } })).toBe(2);
  });

  it('ignores unknown event types without throwing', async () => {
    const tenantId = await seedTenant('w-d');
    await expect(dispatchInSystem('mystery.event', tenantId, { foo: 'bar' })).resolves.toBeUndefined();
    expect(await prisma.notification.count({ where: { tenantId } })).toBe(0);
  });

  it('publisher drains a pending outbox event and marks it published', async () => {
    const tenantId = await seedTenant('w-e');
    const orderId = await seedOrder(tenantId, 'ORD-W-3');
    const eventId = randomUUID();
    await prisma.outboxEvent.create({
      data: { id: eventId, tenantId, type: 'order.paid', payload: { orderId, method: 'Cash' }, status: 'pending' },
    });

    await publisher.drainOnce();

    const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
    expect(event?.status).toBe('published');
    expect(event?.publishedAt).toBeTruthy();
    expect(await prisma.notification.count({ where: { tenantId, type: 'order_paid' } })).toBe(1);
  });

  it('isolates notifications between tenants', async () => {
    const a = await seedTenant('w-f');
    const b = await seedTenant('w-g');
    const orderId = await seedOrder(a, 'ORD-W-4');
    await dispatchInSystem('order.paid', a, { orderId, method: 'Cash' });

    expect(await prisma.notification.count({ where: { tenantId: a } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { tenantId: b } })).toBe(0);
  });

  it('recovers an abandoned processing event after the lease expires', async () => {
    const tenantId = await seedTenant('w-h');
    const orderId = await seedOrder(tenantId, 'ORD-W-5');
    const eventId = randomUUID();
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        tenantId,
        type: 'order.paid',
        payload: { orderId, method: 'Cash' },
        status: 'processing',
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await publisher.drainOnce();

    const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
    expect(event?.status).toBe('published');
    expect(await prisma.notification.count({ where: { tenantId, type: 'order_paid' } })).toBe(1);
  });

  it('does not double-publish a fresh processing event (lease held by another worker)', async () => {
    const tenantId = await seedTenant('w-i');
    const orderId = await seedOrder(tenantId, 'ORD-W-6');
    const eventId = randomUUID();
    await prisma.outboxEvent.create({
      data: {
        id: eventId,
        tenantId,
        type: 'order.paid',
        payload: { orderId, method: 'Cash' },
        status: 'processing',
        lockedAt: new Date(),
      },
    });

    await publisher.drainOnce();

    // A live lease is respected: the event stays processing and is not re-run.
    const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
    expect(event?.status).toBe('processing');
    expect(await prisma.notification.count({ where: { tenantId, type: 'order_paid' } })).toBe(0);
  });
});
