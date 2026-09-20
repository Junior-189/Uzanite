import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { MembershipsService } from '../../src/modules/tenancy/memberships.service';
import { UnitOfWorkService } from '../../src/prisma/unit-of-work.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;

type Member = { id: string; role: string; permissions: string[] };

d('memberships (staff foundation, Postgres)', () => {
  let h: Harness;
  let members: MembershipsService;

  beforeAll(async () => {
    h = await createHarness();
    members = new MembershipsService(
      h.prisma,
      h.uow,
      new OutboxService(h.prisma),
      h.config,
      h.cache,
      h.billing
    );
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const withTenant = <T>(tenantId: string, fn: () => Promise<T>) => runWithRequest({ tenantId }, fn);
  const ownerActor = (userId: string) => ({ userId, role: 'owner', platformRole: null });

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const suffix = tenantId.slice(0, 8);
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${suffix}`, name: label, status: 'approved' } });
    await h.prisma.base.user.create({ data: { id: ownerId, email: `owner-${suffix}@x.com`, name: 'Owner', status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId: ownerId, tenantId, role: 'owner', status: 'active' } });
    return { tenantId, ownerId, suffix };
  }

  it('lists, adds and updates members', async () => {
    const { tenantId, ownerId, suffix } = await seedTenant('mem-a');
    await h.prisma.base.user.create({ data: { id: randomUUID(), email: `staff-${suffix}@x.com`, name: 'Staff', status: 'active' } });

    const added = await withTenant(tenantId, () =>
      members.add(tenantId, { email: `staff-${suffix}@x.com`, role: 'staff', permissions: ['orders'] } as never, ownerActor(ownerId))
    );
    expect(added.member.role).toBe('staff');

    const list = await withTenant(tenantId, () => members.list(tenantId, { limit: 25 } as never));
    expect(list.members).toHaveLength(2);

    const updated = await withTenant(tenantId, () =>
      members.update(tenantId, added.member.id, { permissions: ['orders', 'products'] } as never, ownerActor(ownerId))
    );
    expect(updated.member.permissions).toEqual(['orders', 'products']);
  });

  it('prevents removing the last owner', async () => {
    const { tenantId, ownerId } = await seedTenant('mem-b');
    const list = await withTenant(tenantId, () => members.list(tenantId, { limit: 5 } as never));
    const ownerMembership = (list.members as Member[]).find((m) => m.role === 'owner');
    await expect(
      withTenant(tenantId, () => members.remove(tenantId, ownerMembership!.id, ownerActor(ownerId)))
    ).rejects.toThrow(/last owner/);
  });

  it('prevents a non-owner from granting the owner role', async () => {
    const { tenantId, suffix } = await seedTenant('mem-c');
    const managerId = randomUUID();
    await h.prisma.base.user.create({ data: { id: managerId, email: `mgr-${suffix}@x.com`, name: 'Mgr', status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId: managerId, tenantId, role: 'manager', status: 'active' } });
    await h.prisma.base.user.create({ data: { id: randomUUID(), email: `new-${suffix}@x.com`, name: 'New', status: 'active' } });

    await expect(
      withTenant(tenantId, () =>
        members.add(tenantId, { email: `new-${suffix}@x.com`, role: 'owner', permissions: [] } as never, {
          userId: managerId,
          role: 'manager',
          platformRole: null,
        })
      )
    ).rejects.toThrow(/Only an owner/);
  });

  it('prevents a manager from granting owner-only permissions', async () => {
    const { tenantId, suffix } = await seedTenant('mem-e');
    const managerId = randomUUID();
    await h.prisma.base.user.create({ data: { id: managerId, email: `mgr2-${suffix}@x.com`, name: 'Mgr', status: 'active' } });
    await h.prisma.base.membership.create({ data: { id: randomUUID(), userId: managerId, tenantId, role: 'manager', status: 'active' } });
    await h.prisma.base.user.create({ data: { id: randomUUID(), email: `new2-${suffix}@x.com`, name: 'New', status: 'active' } });

    await expect(
      withTenant(tenantId, () =>
        members.add(tenantId, { email: `new2-${suffix}@x.com`, role: 'staff', permissions: ['manage_staff'] } as never, {
          userId: managerId,
          role: 'manager',
          platformRole: null,
        })
      )
    ).rejects.toThrow(/Only an owner/);
  });

  it('invites a new user, applies role defaults, and accepts once', async () => {
    const { tenantId, ownerId, suffix } = await seedTenant('mem-d');
    const email = `invitee-${suffix}@x.com`;

    const invited = await withTenant(tenantId, () =>
      members.invite(tenantId, { email, role: 'staff', permissions: [] } as never, ownerActor(ownerId))
    );
    expect(invited.invite.role).toBe('staff');

    const event = await h.prisma.base.outboxEvent.findFirst({ where: { tenantId, type: 'email.send' } });
    const token = /token=([a-f0-9]+)/.exec((event!.payload as { html: string }).html)![1];

    const accepted = await members.acceptInvite({ token, name: 'Invitee', password: 'Str0ng!Passw0rd' } as never);
    expect(accepted.success).toBe(true);

    const user = await h.prisma.base.user.findFirst({ where: { email } });
    expect(user).toBeTruthy();
    const membership = await h.prisma.base.membership.findFirst({ where: { userId: user!.id, tenantId } });
    expect(membership?.role).toBe('staff');
    // Staff role defaults applied.
    expect(membership?.permissions).toEqual(['orders', 'products', 'contacts', 'notifications']);

    // Invitations are single-use.
    await expect(members.acceptInvite({ token, name: 'X', password: 'Str0ng!Passw0rd' } as never)).rejects.toThrow(
      /Invalid or expired/
    );
  });
});
