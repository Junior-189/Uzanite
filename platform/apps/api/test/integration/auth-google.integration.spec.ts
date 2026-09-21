import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';

const d = hasDb ? describe : describe.skip;
const CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';

function mockTokeninfo(payload: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })) as never);
}

d('google login (Postgres)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_CLIENT_ID;
  });

  const future = () => Math.floor(Date.now() / 1000) + 600;

  it('is refused when Google is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const err = await h.auth.googleLogin('token', {}).catch((e) => e as { getResponse?: () => { error?: string } });
    expect(err?.getResponse?.().error ?? '').toMatch(/not configured/);
  });

  it('signs in a staff account by email (no tenant is created)', async () => {
    const tenantId = randomUUID();
    await h.prisma.base.tenant.create({ data: { id: tenantId, slug: `gstaff-${tenantId.slice(0, 8)}`, name: 'Shop', status: 'approved' } });
    await h.prisma.base.staff.create({
      data: { id: randomUUID(), tenantId, name: 'Sam', email: 'sam@shop.com', passwordHash: 'x', permissions: ['orders'] },
    });
    mockTokeninfo({ sub: 'g-sub-1', email: 'SAM@shop.com', name: 'Sam', aud: CLIENT_ID, exp: future(), iss: 'https://accounts.google.com', email_verified: true, picture: 'http://img' });

    const res = await h.auth.googleLogin('token', { ip: '127.0.0.1' });
    expect(res.success).toBe(true);
    expect(res.user.role).toBe('staff');
    expect(res.user.businessId).toBe(tenantId);
    expect(await h.prisma.base.user.count()).toBe(0);
  });

  it('creates a pending tenant on first sign-up, then reuses it', async () => {
    mockTokeninfo({ sub: 'g-sub-2', email: 'New@Shop.com', name: 'New Owner', aud: CLIENT_ID, exp: future(), iss: 'https://accounts.google.com', email_verified: true });

    const first = await h.auth.googleLogin('token', {});
    expect(first.pending).toBe(true);
    expect(first.user.businessId).toBeTruthy();
    expect(await h.prisma.base.tenant.count({ where: { status: 'pending' } })).toBe(1);

    const again = await h.auth.googleLogin('token', {});
    expect(again.pending).toBe(true);
    expect(again.user.id).toBe(first.user.id);
    expect(await h.prisma.base.user.count()).toBe(1);
    expect(await h.prisma.base.tenant.count()).toBe(1);
  });

  it('rejects a token whose email is not verified', async () => {
    mockTokeninfo({ sub: 'g-sub-x', email: 'x@shop.com', aud: CLIENT_ID, exp: future(), iss: 'https://accounts.google.com', email_verified: false });
    await expect(h.auth.googleLogin('token', {})).rejects.toThrow(/not verified/i);
  });

  it('rejects a token with the wrong audience and expired tokens', async () => {
    mockTokeninfo({ sub: 'g-sub-3', email: 'x@shop.com', aud: 'someone-else', exp: future(), iss: 'https://accounts.google.com', email_verified: true });
    await expect(h.auth.googleLogin('token', {})).rejects.toThrow(/audience/i);

    mockTokeninfo({ sub: 'g-sub-4', email: 'x@shop.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) - 10, iss: 'https://accounts.google.com', email_verified: true });
    await expect(h.auth.googleLogin('token', {})).rejects.toThrow(/expired/i);
  });
});
