import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { StaffService } from '../../src/modules/staff/staff.service';
import { runWithRequest } from '../../src/context/tenant-context';
import { isEncrypted } from '@uzanite/messaging';
import { blindIndex } from '../../src/security/pii';

const d = hasDb ? describe : describe.skip;

d('staff (Postgres)', () => {
  let h: Harness;
  let staff: StaffService;

  beforeAll(async () => {
    h = await createHarness();
    staff = new StaffService(h.prisma, h.tokens, h.lockout, h.billing, h.outbox);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: label, status: 'approved' } });
    await h.prisma.base.subscription.create({ data: { id: randomUUID(), tenantId, planKey: 'business', status: 'active' } });
    return tenantId;
  }

  const withTenant = <T>(t: string, fn: () => Promise<T>) => runWithRequest({ tenantId: t }, fn);

  it('creates staff, hashes the password and hides it from responses', async () => {
    const t = await seedTenant('st-a');
    const res = await withTenant(t, () =>
      staff.create(t, { name: 'Asha', email: 'ASHA@shop.com', password: 'secret123', permissions: ['orders'] } as never, randomUUID())
    );
    expect(res.staff._id).toBe(res.staff.id);
    expect(res.staff.email).toBe('asha@shop.com');
    expect((res.staff as Record<string, unknown>).passwordHash).toBeUndefined();

    const row = await h.prisma.base.staff.findUnique({ where: { id: res.staff.id } });
    expect(row?.passwordHash).not.toBe('secret123');
    expect(row?.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const t = await seedTenant('st-b');
    const input = { name: 'A', email: 'dupe@shop.com', password: 'secret123' } as never;
    await withTenant(t, () => staff.create(t, input, randomUUID()));
    await expect(withTenant(t, () => staff.create(t, input, randomUUID()))).rejects.toThrow(/already registered/);
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    const t = await seedTenant('st-c');
    await withTenant(t, () =>
      staff.create(t, { name: 'A', email: 'login@shop.com', password: 'secret123', permissions: ['orders', 'products'] } as never, randomUUID())
    );

    const ok = await staff.login({ email: 'login@shop.com', password: 'secret123' } as never, { ip: '127.0.0.1' });
    expect(ok.success).toBe(true);
    expect(typeof ok.token).toBe('string');
    expect(ok.user.role).toBe('staff');
    expect(ok.user.permissions).toEqual(['orders', 'products']);
    expect(ok.user.businessId).toBe(t);
    expect(typeof ok.refreshToken).toBe('string');

    // Staff refresh tokens rotate through the shared table and re-issue a staff token.
    const refreshed = await h.auth.refresh(ok.refreshToken!, {});
    expect(refreshed.success).toBe(true);
    expect(typeof refreshed.token).toBe('string');

    await expect(staff.login({ email: 'login@shop.com', password: 'nope' } as never, {})).rejects.toThrow(/Invalid credentials/);
  });

  it('refuses login for an inactive staff member', async () => {
    const t = await seedTenant('st-d');
    const created = await withTenant(t, () =>
      staff.create(t, { name: 'A', email: 'inactive@shop.com', password: 'secret123' } as never, randomUUID())
    );
    await withTenant(t, () => staff.update(t, created.staff.id, { status: 'inactive' } as never));
    await expect(staff.login({ email: 'inactive@shop.com', password: 'secret123' } as never, {})).rejects.toThrow(/inactive/);
  });

  it('updates permissions/status and lists with counts', async () => {
    const t = await seedTenant('st-e');
    const created = await withTenant(t, () =>
      staff.create(t, { name: 'Asha', email: 'list@shop.com', password: 'secret123', permissions: ['orders'] } as never, randomUUID())
    );
    const updated = await withTenant(t, () => staff.update(t, created.staff.id, { permissions: ['orders', 'reports'] } as never));
    expect(updated.staff.permissions).toEqual(['orders', 'reports']);

    const list = await withTenant(t, () => staff.list(t));
    expect(list.staff).toHaveLength(1);
    expect(list.staff[0]._id).toBe(created.staff.id);
    expect(list.ownerCounts).toBeTruthy();
  });

  it('resets the password (bumps tokenVersion + queues email) and deletes staff', async () => {
    const t = await seedTenant('st-f');
    const created = await withTenant(t, () =>
      staff.create(t, { name: 'A', email: 'reset@shop.com', password: 'secret123' } as never, randomUUID())
    );
    const before = await h.prisma.base.staff.findUnique({ where: { id: created.staff.id } });

    await withTenant(t, () => staff.resetPassword(t, created.staff.id, { password: 'brandnew123' } as never));
    const after = await h.prisma.base.staff.findUnique({ where: { id: created.staff.id } });
    expect(after!.tokenVersion).toBe(before!.tokenVersion + 1);
    const event = await h.prisma.base.outboxEvent.findFirst({ where: { tenantId: t, type: 'email.send' } });
    expect(event).toBeTruthy();

    await withTenant(t, () => staff.remove(t, created.staff.id));
    expect(await h.prisma.base.staff.count({ where: { tenantId: t } })).toBe(0);
  });

  it('encrypts staff email at rest with a blind index and logs in by it', async () => {
    const t = await seedTenant('st-pii');
    const created = await withTenant(t, () =>
      staff.create(t, { name: 'A', email: 'pii@shop.com', password: 'secret123' } as never, randomUUID())
    );
    expect(created.staff.email).toBe('pii@shop.com');

    const raw = await h.prisma.base.staff.findUnique({ where: { id: created.staff.id } });
    expect(isEncrypted(raw!.email)).toBe(true);
    expect(raw!.emailIdx).toBe(blindIndex('pii@shop.com'));

    const ok = await staff.login({ email: 'pii@shop.com', password: 'secret123' } as never, {});
    expect(ok.user.email).toBe('pii@shop.com');
  });
});
