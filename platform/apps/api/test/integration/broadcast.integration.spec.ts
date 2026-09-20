import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { BroadcastService } from '../../src/modules/broadcast/broadcast.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('broadcast (Postgres)', () => {
  let h: Harness;
  let broadcast: BroadcastService;
  const enqueueText = vi.fn(async () => ({ success: true }));

  beforeAll(async () => {
    h = await createHarness();
    const whatsappStub = { health: async () => ({ configured: true }), enqueueText } as never;
    broadcast = new BroadcastService(h.prisma, whatsappStub, h.outbox, h.billing);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    enqueueText.mockClear();
    await resetDb(h.prisma);
  });

  async function seedTenant(label: string) {
    const id = randomUUID();
    await h.prisma.base.tenant.create({ data: { id, slug: `${label}-${id.slice(0, 8)}`, name: label, status: 'approved' } });
    await h.prisma.base.subscription.create({ data: { id: randomUUID(), tenantId: id, planKey: 'business', status: 'active' } });
    return id;
  }

  const withTenant = <T>(t: string, fn: () => Promise<T>) => runWithRequest({ tenantId: t }, fn);

  it('fans out an email broadcast to opted-in contacts and logs it', async () => {
    const t = await seedTenant('bc-a');
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000001', email: 'a@x.com', optIn: true } });
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000002', email: 'b@x.com', optIn: true } });
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000003', email: 'c@x.com', optIn: false } });
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000004', email: 'd@x.com', optIn: true, unsubscribedAt: new Date() } });

    const res = await withTenant(t, () => broadcast.send(t, { message: 'Hello', subject: 'News', channel: 'email' } as never, 'Owner'));
    expect(res.success).toBe(true);
    expect(res.channel).toBe('email');
    expect(res.emailCount).toBe(2);
    expect(res.total).toBe(2);

    const events = await h.prisma.base.outboxEvent.count({ where: { tenantId: t, type: 'email.send' } });
    expect(events).toBe(2);

    const sent = await withTenant(t, () => broadcast.sent(t));
    expect(sent.logs).toHaveLength(1);
    expect(sent.logs[0].subject).toBe('News');
    expect(sent.logs[0].count).toBe(2);
  });

  it('sends WhatsApp broadcasts through the messaging service', async () => {
    const t = await seedTenant('bc-wa');
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000010', optIn: true } });
    const res = await withTenant(t, () => broadcast.send(t, { message: 'Hi', channel: 'whatsapp' } as never, 'Owner'));
    expect(res.whatsappCount).toBe(1);
    expect(enqueueText).toHaveBeenCalledTimes(1);
  });

  it('refuses when there are no opted-in contacts', async () => {
    const t = await seedTenant('bc-none');
    await expect(withTenant(t, () => broadcast.send(t, { message: 'Hi', channel: 'email' } as never, 'Owner'))).rejects.toThrow(/No opted-in contacts/);
  });

  it('manages broadcast contacts: add, list, count and import', async () => {
    const t = await seedTenant('bc-c');
    const added = await withTenant(t, () => broadcast.addContact(t, { email: 'New@X.com', name: 'New' } as never));
    expect(added.contact.email).toBe('new@x.com');
    await expect(withTenant(t, () => broadcast.addContact(t, { email: 'new@x.com' } as never))).rejects.toThrow(/already in your contacts/);

    const imported = await withTenant(t, () =>
      broadcast.importEmails(t, { data: 'email,name\nx@x.com,X\ny@x.com,Y\nbad-email,Z\n' } as never)
    );
    expect(imported.inserted).toBe(2);
    expect(imported.invalid).toBe(1);

    const contacts = await withTenant(t, () => broadcast.contacts(t));
    expect(contacts.contacts.length).toBe(3);

    const count = await withTenant(t, () => broadcast.contactsCount(t));
    expect(count.count).toBe(3);
  });
});
