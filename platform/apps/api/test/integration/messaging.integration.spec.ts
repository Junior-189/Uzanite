import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MetaClient } from '@uzanite/messaging';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { WhatsAppService } from '../../src/modules/messaging/whatsapp.service';
import { WhatsAppWebhookService } from '../../src/modules/messaging/whatsapp-webhook.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { QueueService } from '../../src/queue/queue.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;
const PHONE_NUMBER_ID = 'PN-1001';

d('messaging (WhatsApp Cloud) integration (Postgres)', () => {
  let h: Harness;
  let whatsapp: WhatsAppService;
  let webhook: WhatsAppWebhookService;

  beforeAll(async () => {
    h = await createHarness();
    const outbox = new OutboxService(h.prisma);
    const uow = new UnitOfWorkService(h.prisma);
    const queue = new QueueService(new ConfigService());
    const meta = new MetaClient();
    whatsapp = new WhatsAppService(h.prisma, uow, outbox, queue, meta);
    webhook = new WhatsAppWebhookService(h.prisma, outbox);
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
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: `${label} Ltd`, status: 'approved' } });
    await h.prisma.base.user.create({ data: { id: userId, email: `${label}-${tenantId.slice(0, 8)}@x.com`, name: label, status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId, tenantId, role: 'owner' } });
    return { tenantId, userId };
  }

  async function seedAccount(tenantId: string, phoneNumberId = PHONE_NUMBER_ID) {
    const id = randomUUID();
    await h.prisma.base.whatsAppAccount.create({
      data: { id, tenantId, phoneNumberId, status: 'connected', accessTokenEnc: '' },
    });
    return id;
  }

  it('stores Meta access tokens encrypted and never returns them', async () => {
    const { tenantId } = await seedTenant('wa-a');
    const res = await withTenant(tenantId, () =>
      whatsapp.upsertAccount(tenantId, { phoneNumberId: PHONE_NUMBER_ID, accessToken: 'EAAG-secret-token', verifyToken: 'verify-me' } as never)
    );
    expect(res.account.hasAccessToken).toBe(true);
    expect((res.account as Record<string, unknown>).accessTokenEnc).toBeUndefined();

    const row = await h.prisma.base.whatsAppAccount.findFirst({ where: { tenantId } });
    expect(row?.accessTokenEnc.startsWith('v1.')).toBe(true);
    expect(row?.accessTokenEnc).not.toContain('EAAG-secret-token');
  });

  it('verifies the X-Hub-Signature-256 and the GET challenge', () => {
    const prevSecret = process.env.META_APP_SECRET;
    const prevToken = process.env.META_VERIFY_TOKEN;
    process.env.META_APP_SECRET = 'app-secret';
    process.env.META_VERIFY_TOKEN = 'verify-token';
    try {
      const body = JSON.stringify({ object: 'whatsapp_business_account' });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createHmac } = require('crypto') as typeof import('crypto');
      const sig = 'sha256=' + createHmac('sha256', 'app-secret').update(body).digest('hex');
      expect(webhook.verifySignature(body, sig)).toBe(true);
      expect(webhook.verifySignature(body, 'sha256=deadbeef')).toBe(false);
      expect(webhook.verifySignature(body, undefined)).toBe(false);
      expect(webhook.verifyChallenge('subscribe', 'verify-token', 'challenge-123')).toEqual({ ok: true, challenge: 'challenge-123' });
      expect(webhook.verifyChallenge('subscribe', 'wrong', 'challenge-123').ok).toBe(false);
    } finally {
      process.env.META_APP_SECRET = prevSecret;
      process.env.META_VERIFY_TOKEN = prevToken;
    }
  });

  it('routes inbound webhooks by phone_number_id, records the message, and dedupes retries', async () => {
    const { tenantId } = await seedTenant('wa-b');
    await seedAccount(tenantId);

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                contacts: [{ profile: { name: 'Asha' }, wa_id: '255700111222' }],
                messages: [{ id: 'wamid.IN-1', from: '255700111222', type: 'text', text: { body: 'Hello there' } }],
              },
            },
          ],
        },
      ],
    };

    const first = await webhook.handle(body as never);
    expect(first.processed).toBe(1);
    expect(first.failed).toBe(0);
    expect(first.inbound).toHaveLength(1);

    const contact = await h.prisma.base.whatsAppContact.findFirst({ where: { tenantId, phone: '255700111222' } });
    expect(contact).toBeTruthy();
    const messages = await h.prisma.base.message.findMany({ where: { tenantId, direction: 'inbound' } });
    expect(messages).toHaveLength(1);
    expect(messages[0].providerMessageId).toBe('wamid.IN-1');
    expect(messages[0].text).toBe('Hello there');

    const events = await h.prisma.base.outboxEvent.findMany({ where: { tenantId, type: 'whatsapp.inbound' } });
    expect(events).toHaveLength(1);

    // Meta retry → deduped, no duplicate message.
    const replay = await webhook.handle(body as never);
    expect(replay.processed).toBe(0);
    expect(replay.failed).toBe(0);
    expect(await h.prisma.base.message.count({ where: { tenantId, direction: 'inbound' } })).toBe(1);
  });

  it('applies delivery status updates to the matching outbound message', async () => {
    const { tenantId } = await seedTenant('wa-c');
    await seedAccount(tenantId);
    const messageId = randomUUID();
    await h.prisma.base.message.create({
      data: {
        id: messageId,
        tenantId,
        direction: 'outbound',
        contactPhone: '255700111222',
        status: 'sent',
        providerMessageId: 'wamid.OUT-1',
      },
    });

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.OUT-1', status: 'delivered', timestamp: '1700000000' }],
              },
            },
          ],
        },
      ],
    };
    const res = await webhook.handle(body as never);
    expect(res.processed).toBe(1);
    const row = await h.prisma.base.message.findUnique({ where: { id: messageId } });
    expect(row?.status).toBe('delivered');
  });

  it('ignores webhooks for an unknown phone_number_id', async () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'UNKNOWN' }, messages: [{ id: 'x', from: '1', type: 'text', text: { body: 'hi' } }] } }] }],
    };
    const res = await webhook.handle(body as never);
    expect(res.processed).toBe(0);
    expect(res.failed).toBe(0);
    expect(await h.prisma.base.message.count({})).toBe(0);
  });

  it('enqueues outbound text idempotently and lists messages', async () => {
    const { tenantId } = await seedTenant('wa-d');
    await seedAccount(tenantId);

    const first = await withTenant(tenantId, () =>
      whatsapp.enqueueText(tenantId, { to: '+255700111222', text: 'Your order is ready', idempotencyKey: 'send-1' } as never, 'api')
    );
    expect(first.message.status).toBe('queued');
    expect(first.message.contactPhone).toBe('255700111222');

    const second = await withTenant(tenantId, () =>
      whatsapp.enqueueText(tenantId, { to: '+255700111222', text: 'Your order is ready', idempotencyKey: 'send-1' } as never, 'api')
    );
    expect(second.idempotent).toBe(true);
    expect(second.message.id).toBe(first.message.id);

    const list = await withTenant(tenantId, () => whatsapp.listMessages(tenantId, { limit: 25 } as never));
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0].direction).toBe('outbound');
  });

  it('isolates accounts, messages and contacts between tenants', async () => {
    const a = await seedTenant('wa-e');
    const b = await seedTenant('wa-f');
    await seedAccount(a.tenantId, 'PN-A');
    await withTenant(a.tenantId, () => whatsapp.enqueueText(a.tenantId, { to: '+255700000001', text: 'hi' } as never, 'api'));

    const accountB = await withTenant(b.tenantId, () => whatsapp.getAccount(b.tenantId));
    expect(accountB.account).toBeNull();
    const listB = await withTenant(b.tenantId, () => whatsapp.listMessages(b.tenantId, { limit: 25 } as never));
    expect(listB.messages).toHaveLength(0);
  });

  it('reports connection health per tenant', async () => {
    const { tenantId } = await seedTenant('wa-g');
    await seedAccount(tenantId);
    const health = await withTenant(tenantId, () => whatsapp.health(tenantId));
    expect(health.configured).toBe(false); // seeded account has no token
    expect(health.status).toBe('connected');
    expect(health.counts.queued).toBe(0);
  });
});
