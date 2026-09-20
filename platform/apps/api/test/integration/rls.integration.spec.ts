import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Requires a NON-owner app role URL (TEST_APP_DATABASE_URL) so RLS applies.
const hasAppRole = !!process.env.TEST_APP_DATABASE_URL && !!process.env.TEST_DATABASE_URL;
const d = hasAppRole ? describe : describe.skip;

d('Row Level Security (Postgres, app role)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
    app = new PrismaClient({ datasources: { db: { url: process.env.TEST_APP_DATABASE_URL } } });
    tenantA = randomUUID();
    tenantB = randomUUID();
    await admin.$executeRawUnsafe(
      'TRUNCATE "memberships","tenants","users" RESTART IDENTITY CASCADE'
    );
    const userA = randomUUID();
    const userB = randomUUID();
    await admin.tenant.createMany({
      data: [
        { id: tenantA, slug: `rls-a-${tenantA.slice(0, 8)}`, name: 'A', status: 'approved' },
        { id: tenantB, slug: `rls-b-${tenantB.slice(0, 8)}`, name: 'B', status: 'approved' },
      ],
    });
    await admin.user.createMany({
      data: [
        { id: userA, email: `rls-a-${tenantA.slice(0, 8)}@x.com`, name: 'A', status: 'active' },
        { id: userB, email: `rls-b-${tenantB.slice(0, 8)}@x.com`, name: 'B', status: 'active' },
      ],
    });
    await admin.membership.createMany({
      data: [
        { id: randomUUID(), userId: userA, tenantId: tenantA, role: 'owner' },
        { id: randomUUID(), userId: userB, tenantId: tenantB, role: 'owner' },
      ],
    });
    // Commerce (M4): an order owned by tenant A, to prove RLS on order tables.
    await admin.order.create({
      data: { id: randomUUID(), tenantId: tenantA, orderNumber: 'ORD-RLS-0001', total: '100', currency: 'TZS' },
    });
    // Finance (M5): a payment owned by tenant A, to prove RLS on finance tables.
    await admin.payment.create({
      data: {
        id: randomUUID(),
        tenantId: tenantA,
        amount: '100',
        currency: 'TZS',
        status: 'succeeded',
        providerRef: `rls-${randomUUID()}`,
      },
    });
    // Notifications & Receipts (M6): tenant A rows for RLS coverage.
    await admin.notification.create({
      data: { id: randomUUID(), tenantId: tenantA, type: 'order_paid', title: 'T', message: 'M' },
    });
    await admin.receipt.create({
      data: { id: randomUUID(), tenantId: tenantA, type: 'order', receiptNumber: 'RCP-RLS-1', amount: '100', currency: 'TZS' },
    });
    // Messaging (M7): a message owned by tenant A for RLS coverage.
    await admin.message.create({
      data: { id: randomUUID(), tenantId: tenantA, direction: 'inbound', contactPhone: '255700000000', status: 'received' },
    });
    // Conversations (M8): a conversation owned by tenant A.
    await admin.conversation.create({
      data: { id: randomUUID(), tenantId: tenantA, contactPhone: '255700000000', step: 'MAIN_MENU', language: 'en' },
    });
    // Flow traces (M9): a trace owned by tenant A.
    await admin.flowTrace.create({
      data: { id: randomUUID(), tenantId: tenantA, contactPhone: '255700000000', mode: 'active', input: '1', stepFrom: 'MAIN_MENU', stepTo: 'BROWSE_PRODUCTS' },
    });
  });

  afterAll(async () => {
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('denies all rows when no tenant GUC is set', async () => {
    const rows = await app.membership.findMany({});
    expect(rows).toHaveLength(0);
  });

  it('returns only the active tenant rows when the GUC is set', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.membership.findMany({});
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantA);
  });

  it('bypass GUC allows cross-tenant reads (platform work)', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true)`);
      return tx.membership.findMany({});
    });
    expect(rows.length).toBe(2);
  });

  it('applies RLS to the commerce order tables', async () => {
    // Fail closed with no GUC.
    expect(await app.order.findMany({})).toHaveLength(0);

    // Tenant A sees only its own order.
    const a = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.order.findMany({});
    });
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe(tenantA);

    // Tenant B sees nothing.
    const b = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.order.findMany({});
    });
    expect(b).toHaveLength(0);
  });

  it('applies RLS to the flow_traces table', async () => {
    expect(await app.flowTrace.findMany({})).toHaveLength(0);
    const a = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.flowTrace.findMany({});
    });
    expect(a).toHaveLength(1);
    const b = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.flowTrace.findMany({});
    });
    expect(b).toHaveLength(0);
  });

  it('applies RLS to the conversations table', async () => {
    expect(await app.conversation.findMany({})).toHaveLength(0);
    const a = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.conversation.findMany({});
    });
    expect(a).toHaveLength(1);
    const b = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.conversation.findMany({});
    });
    expect(b).toHaveLength(0);
  });

  it('applies RLS to the messaging tables', async () => {
    expect(await app.message.findMany({})).toHaveLength(0);
    const a = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.message.findMany({});
    });
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe(tenantA);
    const b = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.message.findMany({});
    });
    expect(b).toHaveLength(0);
  });

  it('applies RLS to the notifications and receipts tables', async () => {
    expect(await app.notification.findMany({})).toHaveLength(0);
    expect(await app.receipt.findMany({})).toHaveLength(0);

    const notifA = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.notification.findMany({});
    });
    expect(notifA).toHaveLength(1);
    expect(notifA[0].tenantId).toBe(tenantA);

    const receiptB = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.receipt.findMany({});
    });
    expect(receiptB).toHaveLength(0);
  });

  it('applies RLS to the finance tables', async () => {
    expect(await app.payment.findMany({})).toHaveLength(0);

    const a = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantA}', true)`);
      return tx.payment.findMany({});
    });
    expect(a).toHaveLength(1);
    expect(a[0].tenantId).toBe(tenantA);

    const b = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant', '${tenantB}', true)`);
      return tx.payment.findMany({});
    });
    expect(b).toHaveLength(0);
  });
});
