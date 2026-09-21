import { describe, it, expect, beforeEach } from 'vitest';
import { generate } from 'otplib';
import { TotpService } from './totp.service';

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789abcdef0123456789abcdef';

interface FakeUser {
  id: string;
  email: string;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpRecoveryHashes: string[];
}

// Minimal in-memory stand-in for PrismaService.
class FakePrisma {
  user: FakeUser = { id: 'u1', email: 'owner@example.com', totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashes: [] };
  db = {
    user: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === this.user.id ? { ...this.user } : null,
      update: async ({ data }: { data: Partial<FakeUser> }) => {
        Object.assign(this.user, data);
        return { ...this.user };
      },
    },
  };
}

describe('TotpService', () => {
  let prisma: FakePrisma;
  let svc: TotpService;

  beforeEach(() => {
    prisma = new FakePrisma();
    svc = new TotpService(prisma as never);
  });

  it('enrolls, activates with a valid code, and issues recovery codes', async () => {
    const { secret, otpauthUrl } = await svc.beginEnrollment('u1');
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toContain('otpauth://totp/');
    expect(prisma.user.totpEnabledAt).toBeNull();

    const code = await generate({ secret });
    const { recoveryCodes } = await svc.confirmEnrollment('u1', code);
    expect(recoveryCodes).toHaveLength(8);
    expect(prisma.user.totpEnabledAt).toBeInstanceOf(Date);
    // Recovery codes are stored hashed, never in the clear.
    expect(prisma.user.totpRecoveryHashes).not.toContain(recoveryCodes[0]);
  });

  it('verifies a TOTP code and consumes a recovery code once', async () => {
    const { secret } = await svc.beginEnrollment('u1');
    const code = await generate({ secret });
    const { recoveryCodes } = await svc.confirmEnrollment('u1', code);

    expect(await svc.verifyForUser('u1', '000000')).toBe(false);
    expect(await svc.verifyForUser('u1', recoveryCodes[0])).toBe(true);
    // Single use.
    expect(await svc.verifyForUser('u1', recoveryCodes[0])).toBe(false);
  });

  it('rejects enrollment confirmation with a wrong code', async () => {
    await svc.beginEnrollment('u1');
    await expect(svc.confirmEnrollment('u1', '123456')).rejects.toThrow(/Invalid authentication code/);
  });

  it('returns false when 2FA is not enabled', async () => {
    expect(await svc.verifyForUser('u1', '123456')).toBe(false);
  });
});
