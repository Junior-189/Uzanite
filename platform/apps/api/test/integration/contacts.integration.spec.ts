import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { ContactsService } from '../../src/modules/contacts/contacts.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

d('contacts (Postgres)', () => {
  let h: Harness;
  let contacts: ContactsService;

  beforeAll(async () => {
    h = await createHarness();
    contacts = new ContactsService(h.prisma, new OutboxService(h.prisma), h.config);
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

  it('adds (idempotently), lists and updates contacts', async () => {
    const t = await seedTenant('ct-a');
    const first = await withTenant(t, () => contacts.add(t, { phone: '+255 700 111 222', name: 'Asha' } as never));
    expect(first.contact.phone).toBe('255700111222');
    expect(first.contact._id).toBe(first.contact.id);

    const again = await withTenant(t, () => contacts.add(t, { phone: '255700111222', name: 'Asha' } as never));
    expect(again.message).toMatch(/already exists/);

    const list = await withTenant(t, () => contacts.list(t, { limit: 50 } as never));
    expect(list.count).toBe(1);

    const updated = await withTenant(t, () => contacts.update(t, '255700111222', { email: 'ASHA@Example.com' } as never));
    expect(updated.contact.email).toBe('asha@example.com');
  });

  it('soft-deletes, restores and permanently deletes a contact', async () => {
    const t = await seedTenant('ct-b');
    await withTenant(t, () => contacts.add(t, { phone: '255700111333' } as never));
    await withTenant(t, () => contacts.remove(t, '255700111333', randomUUID(), false));
    expect((await withTenant(t, () => contacts.list(t, { limit: 50 } as never))).count).toBe(0);

    await withTenant(t, () => contacts.restore(t, '255700111333'));
    expect((await withTenant(t, () => contacts.list(t, { limit: 50 } as never))).count).toBe(1);

    await withTenant(t, () => contacts.remove(t, '255700111333', randomUUID(), true));
    expect(await h.prisma.base.whatsAppContact.count({ where: { tenantId: t } })).toBe(0);
  });

  it('returns chat history for a contact within the tenant', async () => {
    const t = await seedTenant('ct-c');
    await withTenant(t, () => contacts.add(t, { phone: '255700111444' } as never));
    await h.prisma.base.message.create({
      data: { id: randomUUID(), tenantId: t, contactPhone: '255700111444', direction: 'inbound', text: 'hello', status: 'received' },
    });
    const res = await withTenant(t, () => contacts.messages(t, '255700111444', 50));
    expect(res.count).toBe(1);
    expect(res.messages[0].text).toBe('hello');
  });

  it('queues a contact email via the outbox', async () => {
    const t = await seedTenant('ct-d');
    await withTenant(t, () => contacts.add(t, { phone: '255700111555' } as never));
    await withTenant(t, () => contacts.update(t, '255700111555', { email: 'a@b.com' } as never));
    await withTenant(t, () => contacts.sendEmail(t, '255700111555', { subject: 'Hi', message: 'Line1\nLine2' } as never));
    const event = await h.prisma.base.outboxEvent.findFirst({ where: { tenantId: t, type: 'email.send' } });
    expect(event).toBeTruthy();
  });
});
