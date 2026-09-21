import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { WhatsAppService } from '../../src/modules/messaging/whatsapp.service';
import { WhatsAppController } from '../../src/modules/messaging/whatsapp.controller';
import { ChatController } from '../../src/modules/messaging/chat.controller';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('whatsapp account adapters + chat (Postgres)', () => {
  let h: Harness;
  let whatsapp: WhatsAppService;
  let waController: WhatsAppController;
  let chat: ChatController;
  const queueStub = { add: async () => ({}) };

  beforeAll(async () => {
    h = await createHarness();
    whatsapp = new WhatsAppService(h.prisma, h.uow, h.outbox, queueStub as never, {} as never);
    waController = new WhatsAppController(whatsapp);
    chat = new ChatController(whatsapp);
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

  const withTenant = <T>(t: string, fn: () => Promise<T>) => runWithRequest({ tenantId: t }, fn);

  it('exposes the legacy account lifecycle shapes', async () => {
    const t = await seedTenant('wa');
    await withTenant(t, () =>
      whatsapp.upsertAccount(t, { phoneNumberId: 'PN123', wabaId: 'W1', accessToken: 'token', verifyToken: 'verify', displayPhoneNumber: '+255700000000' } as never)
    );

    const creds = await withTenant(t, () => waController.metaCredentials(t));
    expect(creds.account?.phoneNumberId).toBe('PN123');
    expect(creds.account?.hasToken).toBe(true);
    expect((creds.account as Record<string, unknown>).accessTokenEnc).toBeUndefined();

    const status = await withTenant(t, () => waController.status(t));
    expect(status.transport).toBe('meta');
    expect(status.status).toBe('pending');
    expect(status.connected).toBe(false);

    await withTenant(t, () => waController.pause(t));
    expect((await withTenant(t, () => waController.status(t))).botPaused).toBe(true);
    await withTenant(t, () => waController.resume(t));
    expect((await withTenant(t, () => waController.status(t))).botPaused).toBe(false);

    await withTenant(t, () => waController.disconnect(t));
    const after = await withTenant(t, () => waController.status(t));
    expect(after.status).toBe('unconfigured');
    expect(after.connected).toBe(false);
  });

  it('serves chat history and enqueues outbound sends', async () => {
    const t = await seedTenant('chat');
    await withTenant(t, () => whatsapp.upsertAccount(t, { phoneNumberId: 'PN9', accessToken: 'token' } as never));

    await withTenant(t, () => chat.send(t, { userId: randomUUID(), name: 'Owner' } as never, { phone: '255712345678', message: 'Hello' }));
    const history = await withTenant(t, () => chat.history(t, { phone: '255712345678' }));
    expect(history.success).toBe(true);
    expect(history.messages.length).toBe(1);
    expect((history.messages[0] as { status: string }).status).toBe('queued');
  });
});
