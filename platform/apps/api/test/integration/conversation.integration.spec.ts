import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MetaClient } from '@uzanite/messaging';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { StockService } from '../../src/modules/catalog/stock.service';
import { OrdersService } from '../../src/modules/commerce/orders.service';
import { BillingService } from '../../src/modules/billing/billing.service';
import { LedgerService } from '../../src/modules/finance/ledger.service';
import { PaymentsService } from '../../src/modules/finance/payments.service';
import { PaymentAdaptersService } from '../../src/modules/finance/payments/payment-adapters.service';
import { WhatsAppService } from '../../src/modules/messaging/whatsapp.service';
import { ConversationService } from '../../src/modules/conversation/conversation.service';
import { decryptPii } from '../../src/security/pii';
import { isEncrypted } from '@uzanite/messaging';
import { OutboxService } from '../../src/outbox/outbox.service';
import { QueueService } from '../../src/queue/queue.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('conversation flows (Postgres)', () => {
  let h: Harness;
  let products: ProductsService;
  let orders: OrdersService;
  let conversation: ConversationService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    const stock = new StockService(h.prisma, outbox);
    const uow = new UnitOfWorkService(h.prisma);
    const billing = h.billing;
    const ledger = new LedgerService(h.prisma);
    products = new ProductsService(h.prisma, stock, new LocalStorageService(h.config));
    orders = new OrdersService(h.prisma, stock, outbox, billing, ledger);
    const adapters = new PaymentAdaptersService();
    const payments = new PaymentsService(h.prisma, orders, ledger, outbox, adapters);
    const queue = new QueueService(new ConfigService());
    const whatsapp = new WhatsAppService(h.prisma, uow, outbox, queue, new MetaClient());
    conversation = new ConversationService(h.prisma, uow, products, orders, payments, whatsapp);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);

  async function seedTenant(label: string, flowMode: 'off' | 'shadow' | 'active' = 'active') {
    const tenantId = randomUUID();
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: `${label} Ltd`, status: 'approved', phone: '+255700000000' } });
    const accountId = randomUUID();
    await h.prisma.base.whatsAppAccount.create({
      data: { id: accountId, tenantId, phoneNumberId: `PN-${tenantId.slice(0, 6)}`, status: 'connected', flowMode },
    });
    return { tenantId, accountId };
  }

  async function seedProduct(tenantId: string, name: string, price: number, stock: number, minPrice = 0) {
    const res = await withTenant(tenantId, () => products.create(tenantId, { name, price, stock, minPrice } as never, 'Owner'));
    return res.product;
  }

  async function seedAdmin(tenantId: string, phone: string) {
    const userId = randomUUID();
    await h.prisma.base.user.create({ data: { id: userId, email: `${userId.slice(0, 8)}@x.com`, name: 'Admin', phone, status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
  }

  function say(tenantId: string, accountId: string, phone: string, text: string, interactiveId: string | null = null) {
    return conversation.processInbound({
      tenantId,
      accountId,
      phone,
      text,
      messageType: interactiveId ? 'interactive' : 'text',
      providerMessageId: randomUUID(),
      interactiveId,
    });
  }

  async function outbound(tenantId: string) {
    return h.prisma.base.message.findMany({ where: { tenantId, direction: 'outbound' }, orderBy: { createdAt: 'asc' } });
  }

  // Text of a reply: plain text messages use `text`; interactive use raw.body.
  async function outboundText(tenantId: string) {
    return (await outbound(tenantId))
      .map((m) => m.text || ((m.raw as { body?: string } | null)?.body ?? ''))
      .join(' ');
  }

  it('does nothing when the flow mode is off (Express owns the flow)', async () => {
    const { tenantId, accountId } = await seedTenant('cv-off', 'off');
    await seedProduct(tenantId, 'Soda', 1000, 10);
    await say(tenantId, accountId, '255700111222', '1');
    expect(await h.prisma.base.conversation.count({ where: { tenantId } })).toBe(0);
    expect(await outbound(tenantId)).toHaveLength(0);
  });

  it('runs the language selection and main menu', async () => {
    const { tenantId, accountId } = await seedTenant('cv-menu');
    await seedProduct(tenantId, 'Soda', 1000, 10);

    await say(tenantId, accountId, '255700111222', '1'); // English
    const conv = await h.prisma.base.conversation.findFirst({ where: { tenantId } });
    expect(conv?.language).toBe('en');
    expect(conv?.step).toBe('MAIN_MENU');

    const msgs = await outbound(tenantId);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(await outboundText(tenantId)).toContain('Browse products');
  });

  it('places an order through Commerce (browse → detail → cart → checkout)', async () => {
    const { tenantId, accountId } = await seedTenant('cv-order');
    await seedProduct(tenantId, 'Soda', 1500, 10);

    const phone = '255700111222';
    await say(tenantId, accountId, phone, '1'); // language en
    await say(tenantId, accountId, phone, '1'); // browse
    await say(tenantId, accountId, phone, '1'); // product 1
    await say(tenantId, accountId, phone, '2'); // qty 2 -> cart
    await say(tenantId, accountId, phone, '1'); // checkout
    await say(tenantId, accountId, phone, 'Alice'); // name
    await say(tenantId, accountId, phone, 'Kariakoo'); // location
    await say(tenantId, accountId, phone, '0712345678'); // phone -> create order

    const created = await h.prisma.base.order.findMany({ where: { tenantId } });
    expect(created).toHaveLength(1);
    // PII is encrypted at rest; the API decrypts on read.
    expect(isEncrypted(created[0].customerName)).toBe(true);
    expect(decryptPii(created[0].customerName)).toBe('Alice');
    expect(Number(created[0].total)).toBe(3000);
    expect(created[0].status).toBe('PENDING');

    // Stock deducted by the Commerce domain.
    const product = await h.prisma.base.product.findFirst({ where: { tenantId } });
    expect(product?.stock).toBe(8);

    const text = await outboundText(tenantId);
    expect(text).toContain(created[0].orderNumber);
    expect(text).toContain('received');
  });

  it('honours a negotiated offer within the min price', async () => {
    const { tenantId, accountId } = await seedTenant('cv-offer');
    await seedProduct(tenantId, 'Bag', 1000, 10, 800); // minPrice 800

    const phone = '255700111333';
    await say(tenantId, accountId, phone, '2'); // swahili
    await say(tenantId, accountId, phone, '1'); // browse
    await say(tenantId, accountId, phone, '1'); // product
    await say(tenantId, accountId, phone, '2'); // qty 2 -> subtotal 2000, minTotal 1600
    await say(tenantId, accountId, phone, '1'); // checkout
    await say(tenantId, accountId, phone, 'Juma');
    await say(tenantId, accountId, phone, 'Mwanza');
    await say(tenantId, accountId, phone, '0712000000'); // -> offer prompt
    await say(tenantId, accountId, phone, '1700'); // offer accepted

    const order = await h.prisma.base.order.findFirst({ where: { tenantId } });
    expect(order).toBeTruthy();
    expect(Number(order?.total)).toBe(1700);
    expect(Number(order?.originalTotal)).toBe(2000);
  });

  it('lists a customer\'s recent orders', async () => {
    const { tenantId, accountId } = await seedTenant('cv-myorders');
    const p = await seedProduct(tenantId, 'Soda', 1000, 10);
    await withTenant(tenantId, () =>
      orders.create(tenantId, { customerPhone: '255700111222', customerName: 'Asha', items: [{ productId: p.id, quantity: 1 }] } as never, 'Owner')
    );

    await say(tenantId, accountId, '255700111222', '1'); // language
    await say(tenantId, accountId, '255700111222', '2'); // my orders
    expect(await outboundText(tenantId)).toContain('ORD-');
  });

  it('runs admin commands (HELP, ORDERS, APPROVE)', async () => {
    const { tenantId, accountId } = await seedTenant('cv-admin');
    const p = await seedProduct(tenantId, 'Soda', 1000, 10);
    await seedAdmin(tenantId, '255700999888');
    const orderRes = await withTenant(tenantId, () =>
      orders.create(tenantId, { customerPhone: '255700111222', customerName: 'Asha', items: [{ productId: p.id, quantity: 1 }] } as never, 'Owner')
    );
    const orderNumber = orderRes.order.orderNumber;

    await say(tenantId, accountId, '255700999888', 'HELP');
    await say(tenantId, accountId, '255700999888', 'ORDERS PENDING');
    await say(tenantId, accountId, '255700999888', `APPROVE ${orderNumber}`);

    const order = await h.prisma.base.order.findFirst({ where: { tenantId } });
    expect(order?.status).toBe('PENDING_PAYMENT');
    const text = await outboundText(tenantId);
    expect(text).toContain('APPROVE');
    expect(text).toContain(orderNumber);
  });

  it('shadow mode updates state but sends no replies', async () => {
    const { tenantId, accountId } = await seedTenant('cv-shadow', 'shadow');
    await seedProduct(tenantId, 'Soda', 1000, 10);

    await say(tenantId, accountId, '255700111222', '1');
    const conv = await h.prisma.base.conversation.findFirst({ where: { tenantId } });
    expect(conv?.step).toBe('MAIN_MENU');
    expect(await outbound(tenantId)).toHaveLength(0);
  });

  it('isolates conversation state between tenants for the same phone', async () => {
    const a = await seedTenant('cv-a');
    const b = await seedTenant('cv-b');
    await seedProduct(a.tenantId, 'A', 100, 5);
    await seedProduct(b.tenantId, 'B', 200, 5);

    await say(a.tenantId, a.accountId, '255700111222', '1');
    await say(a.tenantId, a.accountId, '255700111222', '1'); // browse -> A's products
    expect(await outboundText(a.tenantId)).toContain('A');

    expect(await h.prisma.base.conversation.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });

  // ── Phase M9 ────────────────────────────────────────────────────────────────
  it('sends native interactive replies (buttons + list) for menus', async () => {
    const { tenantId, accountId } = await seedTenant('cv-interactive');
    await seedProduct(tenantId, 'Soda', 1000, 10);
    await say(tenantId, accountId, '255700111222', 'hi'); // language prompt -> buttons
    await say(tenantId, accountId, '255700111222', '1'); // language set -> main menu list

    const interactive = (await outbound(tenantId)).filter((m) => m.messageType === 'interactive');
    expect(interactive.length).toBeGreaterThanOrEqual(2);
    const kinds = interactive.map((m) => (m.raw as { kind?: string }).kind);
    expect(kinds).toContain('buttons');
    expect(kinds).toContain('list');
  });

  it('accepts an inbound interactive reply id as the flow input', async () => {
    const { tenantId, accountId } = await seedTenant('cv-btn');
    await seedProduct(tenantId, 'Soda', 1000, 10);
    await say(tenantId, accountId, '255700111222', '1'); // language
    await say(tenantId, accountId, '255700111222', '', '1'); // button id "1" -> browse
    const conv = await h.prisma.base.conversation.findFirst({ where: { tenantId } });
    expect(conv?.step).toBe('BROWSE_PRODUCTS');
  });

  it('persists a payment reference through the Commerce path', async () => {
    const { tenantId, accountId } = await seedTenant('cv-proof');
    const p = await seedProduct(tenantId, 'Soda', 1000, 10);
    const created = await withTenant(tenantId, () =>
      orders.create(tenantId, { customerPhone: '255700111222', customerName: 'Asha', items: [{ productId: p.id, quantity: 1 }] } as never, 'Owner')
    );
    await withTenant(tenantId, () => orders.approve(tenantId, created.order.id, 'ok', 'Owner')); // -> PENDING_PAYMENT

    await say(tenantId, accountId, '255700111222', '1'); // language -> MAIN_MENU
    await say(tenantId, accountId, '255700111222', 'TX-12345'); // reference captured as proof

    const order = await h.prisma.base.order.findUnique({ where: { id: created.order.id } });
    expect(order?.status).toBe('PENDING_PAYMENT');
    expect(order?.paymentReference).toBe('TX-12345');
    expect(await outboundText(tenantId)).toContain('TX-12345');
  });

  it('supports the QUICK_ADD admin command', async () => {
    const { tenantId, accountId } = await seedTenant('cv-quickadd');
    await seedAdmin(tenantId, '255700999888');
    await say(tenantId, accountId, '255700999888', 'QUICK_ADD Soap|Liquid soap|2000|50');

    const product = await h.prisma.base.product.findFirst({ where: { tenantId, name: 'Soap' } });
    expect(product).toBeTruthy();
    expect(Number(product?.price)).toBe(2000);
    expect(product?.stock).toBe(50);
  });

  it('records flow traces for parity review', async () => {
    const { tenantId, accountId } = await seedTenant('cv-trace');
    await seedProduct(tenantId, 'Soda', 1000, 10);
    await say(tenantId, accountId, '255700111222', '1');

    const traces = await h.prisma.base.flowTrace.findMany({ where: { tenantId } });
    expect(traces).toHaveLength(1);
    expect(traces[0].mode).toBe('active');
    expect(traces[0].stepTo).toBe('MAIN_MENU');
    expect((traces[0].replies as unknown[]).length).toBeGreaterThan(0);
  });

  it('records but does not reply when the bot is paused', async () => {
    const { tenantId, accountId } = await seedTenant('cv-paused');
    await h.prisma.base.whatsAppAccount.updateMany({ where: { tenantId }, data: { botPaused: true } });
    await seedProduct(tenantId, 'Soda', 1000, 10);

    await say(tenantId, accountId, '255700111222', '1');
    expect(await outbound(tenantId)).toHaveLength(0);
    const traces = await h.prisma.base.flowTrace.findMany({ where: { tenantId } });
    expect(traces[0]?.mode).toBe('paused');
  });

  it('resets a conversation after inactivity', async () => {
    const { tenantId, accountId } = await seedTenant('cv-stale');
    await seedProduct(tenantId, 'Soda', 1000, 10);
    await say(tenantId, accountId, '255700111222', '1'); // language -> MAIN_MENU
    await h.prisma.base.conversation.updateMany({
      where: { tenantId },
      data: { step: 'CART', lastActivityAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
    await say(tenantId, accountId, '255700111222', '1'); // reset to MAIN_MENU, then browse
    const conv = await h.prisma.base.conversation.findFirst({ where: { tenantId } });
    expect(conv?.step).toBe('BROWSE_PRODUCTS');
  });

  it('cleans up stale conversations back to the main menu', async () => {
    const { tenantId } = await seedTenant('cv-cleanup');
    await h.prisma.base.conversation.create({
      data: { id: randomUUID(), tenantId, contactPhone: '255700000001', step: 'CART', lastActivityAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    const reset = await conversation.cleanupStale(24);
    expect(reset).toBeGreaterThanOrEqual(1);
    const conv = await h.prisma.base.conversation.findFirst({ where: { tenantId } });
    expect(conv?.step).toBe('MAIN_MENU');
  });

  it('creates state via upsert and advances the optimistic version per message', async () => {
    const { tenantId } = await seedTenant('conv-ver');
    const account = await h.prisma.base.whatsAppAccount.findFirst({ where: { tenantId } });

    await say(tenantId, account!.id, '255700000123', 'Hi');
    const first = await h.prisma.base.conversation.findFirst({ where: { tenantId, contactPhone: '255700000123' } });
    expect(first).toBeTruthy();
    expect(first!.version).toBeGreaterThanOrEqual(1);

    await say(tenantId, account!.id, '255700000123', 'Hello again');
    const second = await h.prisma.base.conversation.findFirst({ where: { tenantId, contactPhone: '255700000123' } });
    expect(second!.version).toBe(first!.version + 1);
  });
});
