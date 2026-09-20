import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { MetaApiError, MetaClient, encrypt } from '@uzanite/messaging';
import { randomUUID } from 'crypto';
import { hasDb, resetDb } from './setup';
import { WhatsAppOutboundService } from '../src/messaging/whatsapp-outbound.service';

const d = hasDb ? describe : describe.skip;

class FakeMeta {
  mode: 'ok' | 'permanent' | 'transient' = 'ok';
  lastText: { to: string; text: string } | null = null;
  async sendText(_creds: unknown, to: string, text: string) {
    this.lastText = { to, text };
    if (this.mode === 'permanent') throw new MetaApiError('invalid recipient', { status: 400, permanent: true });
    if (this.mode === 'transient') throw new MetaApiError('temporary upstream error', { permanent: false });
    return { messageId: 'wamid.SENT-1', raw: { ok: true } };
  }
  async sendTemplate(_creds: unknown, _to: string, _t: unknown) {
    return { messageId: 'wamid.SENT-T', raw: {} };
  }
  async sendMedia(_creds: unknown, _to: string, _m: unknown) {
    return { messageId: 'wamid.SENT-M', raw: {} };
  }
}

d('whatsapp outbound sender (worker, Postgres)', () => {
  let prisma: PrismaClient;
  let fake: FakeMeta;
  let sender: WhatsAppOutboundService;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    fake = new FakeMeta();
    sender = new WhatsAppOutboundService(fake as unknown as MetaClient);
  });
  afterAll(async () => {
    await sender.onApplicationShutdown();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    fake.mode = 'ok';
    fake.lastText = null;
    await resetDb(prisma);
  });

  async function seedTenantWithAccount() {
    const tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, slug: `wa-${tenantId.slice(0, 8)}`, name: 'WA', status: 'approved' } });
    await prisma.whatsAppAccount.create({
      data: { id: randomUUID(), tenantId, phoneNumberId: `PN-${tenantId.slice(0, 6)}`, status: 'connected', accessTokenEnc: encrypt('EAAG-token') },
    });
    return tenantId;
  }

  async function seedQueuedMessage(tenantId: string, text = 'hello') {
    const id = randomUUID();
    await prisma.message.create({
      data: { id, tenantId, direction: 'outbound', contactPhone: '255700111222', messageType: 'text', text, status: 'queued' },
    });
    return id;
  }

  it('sends a queued message and marks it sent with the provider message id', async () => {
    const tenantId = await seedTenantWithAccount();
    const id = await seedQueuedMessage(tenantId, 'Your order is ready');

    const result = await sender.sendOne(id);
    expect(result.status).toBe('sent');
    expect(fake.lastText).toEqual({ to: '255700111222', text: 'Your order is ready' });

    const row = await prisma.message.findUnique({ where: { id } });
    expect(row?.status).toBe('sent');
    expect(row?.providerMessageId).toBe('wamid.SENT-1');
    expect(row?.sentAt).toBeTruthy();
  });

  it('marks a permanent provider error as failed without retrying', async () => {
    const tenantId = await seedTenantWithAccount();
    const id = await seedQueuedMessage(tenantId);
    fake.mode = 'permanent';

    const result = await sender.sendOne(id);
    expect(result.status).toBe('failed');
    const row = await prisma.message.findUnique({ where: { id } });
    expect(row?.status).toBe('failed');
    expect(row?.attempts).toBe(1);
    expect(row?.errorMessage).toContain('invalid recipient');
  });

  it('requeues a transient error with backoff for retry', async () => {
    const tenantId = await seedTenantWithAccount();
    const id = await seedQueuedMessage(tenantId);
    fake.mode = 'transient';

    const result = await sender.sendOne(id);
    expect(result.status).toBe('queued');
    const row = await prisma.message.findUnique({ where: { id } });
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(1);
    expect(row?.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('enqueues idempotently by idempotency key', async () => {
    const tenantId = await seedTenantWithAccount();
    const first = await prisma.$transaction((tx) =>
      sender.enqueue(tx, { tenantId, to: '+255700111222', text: 'hi', idempotencyKey: 'k-1' })
    );
    const second = await prisma.$transaction((tx) =>
      sender.enqueue(tx, { tenantId, to: '+255700111222', text: 'hi', idempotencyKey: 'k-1' })
    );
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(await prisma.message.count({ where: { tenantId } })).toBe(1);
  });

  it('drains the durable queue in one cycle', async () => {
    const tenantId = await seedTenantWithAccount();
    await seedQueuedMessage(tenantId, 'one');
    await seedQueuedMessage(tenantId, 'two');

    await sender.drainOnce();

    const sent = await prisma.message.findMany({ where: { tenantId, status: 'sent' } });
    expect(sent).toHaveLength(2);
  });
});
