import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHarness, resetDb, hasDb, Harness } from './setup';

const d = hasDb ? describe : describe.skip;

d('auth integration (Postgres)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function registerAndApprove(email: string) {
    const reg = await h.auth.register({
      name: 'Owner',
      email,
      password: 'Str0ng!Passw0rd',
      phone: '',
    } as never);
    await h.prisma.base.tenant.update({ where: { slug: (reg.user as { slug: string }).slug }, data: { status: 'approved' } });
    await h.prisma.base.user.update({ where: { email }, data: { status: 'active' } });
    return reg;
  }

  it('registers, logs in, rotates refresh tokens and detects reuse', async () => {
    await registerAndApprove('a@example.com');

    const login = await h.auth.login({ email: 'a@example.com', password: 'Str0ng!Passw0rd' } as never, {});
    expect(login.token).toBeTruthy();
    expect(login.refreshToken).toBeTruthy();

    const rotated = await h.auth.refresh(login.refreshToken as string, {});
    expect(rotated.refreshToken).not.toBe(login.refreshToken);

    // Reusing the original (now revoked) token must fail and revoke the family.
    await expect(h.auth.refresh(login.refreshToken as string, {})).rejects.toThrow();
    await expect(h.auth.refresh(rotated.refreshToken as string, {})).rejects.toThrow();
  });

  it('resets a password and invalidates old tokens', async () => {
    await registerAndApprove('b@example.com');
    const login = await h.auth.login({ email: 'b@example.com', password: 'Str0ng!Passw0rd' } as never, {});

    const forgot = await h.auth.forgotPassword('b@example.com');
    expect(forgot.success).toBe(true);

    // Pull the raw token from the outbox payload (worker would email it).
    const event = await h.prisma.base.outboxEvent.findFirst({ where: { type: 'email.send' }, orderBy: { createdAt: 'desc' } });
    const html = String((event?.payload as { html?: string })?.html ?? '');
    const token = /token=([a-f0-9]+)/.exec(html)?.[1];
    expect(token).toBeTruthy();

    await h.auth.resetPassword(token as string, 'N3w!Passw0rd');
    await expect(h.auth.refresh(login.refreshToken as string, {})).rejects.toThrow();
    const relogin = await h.auth.login({ email: 'b@example.com', password: 'N3w!Passw0rd' } as never, {});
    expect(relogin.success).toBe(true);
  });

  it('locks out after repeated failures', async () => {
    await registerAndApprove('c@example.com');
    for (let i = 0; i < 5; i++) {
      await h.auth.login({ email: 'c@example.com', password: 'wrong' } as never, {}).catch(() => undefined);
    }
    await expect(h.auth.login({ email: 'c@example.com', password: 'Str0ng!Passw0rd' } as never, {})).rejects.toMatchObject({
      status: 429,
    });
  });
});
