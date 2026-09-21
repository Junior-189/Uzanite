import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt, encrypt, randomToken, sha256 } from '../crypto/crypto';

const ISSUER = 'UZANITE';
const RECOVERY_CODE_COUNT = 8;

/**
 * TOTP two-factor authentication (RFC 6238) with single-use recovery codes.
 *
 * The shared secret is stored AES-256-GCM encrypted; recovery codes are stored
 * as SHA-256 hashes and consumed on use. Enrollment is two-step: `beginEnrollment`
 * stores a provisional secret, `confirmEnrollment` verifies a code and activates
 * 2FA, returning recovery codes ONCE.
 */
@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  constructor(private readonly prisma: PrismaService) {}

  async beginEnrollment(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is already enabled');

    const secret = generateSecret();
    await this.prisma.db.user.update({ where: { id: userId }, data: { totpSecretEnc: encrypt(secret) } });
    const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
    return { secret, otpauthUrl };
  }

  async confirmEnrollment(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId } });
    if (!user?.totpSecretEnc) throw new BadRequestException('Start two-factor enrollment first');
    if (user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is already enabled');

    const secret = decrypt(user.totpSecretEnc);
    if (!secret) throw new BadRequestException('Two-factor secret is unavailable');
    if (!(await this.checkCode(secret, code))) throw new UnauthorizedException('Invalid authentication code');

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomToken(5).toUpperCase());
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date(), totpRecoveryHashes: recoveryCodes.map((c) => sha256(c)) },
    });
    this.logger.log(`TOTP enabled for user ${userId}`);
    return { recoveryCodes };
  }

  async disable(userId: string): Promise<{ success: true }> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { totpEnabledAt: null, totpSecretEnc: null, totpRecoveryHashes: [] },
    });
    this.logger.log(`TOTP disabled for user ${userId}`);
    return { success: true };
  }

  /** Verifies a TOTP code or consumes a recovery code. */
  async verifyForUser(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecretEnc) return false;

    const provided = String(code ?? '').trim();
    if (!provided) return false;

    const secret = decrypt(user.totpSecretEnc);
    if (secret && (await this.checkCode(secret, provided))) return true;

    const hash = sha256(provided.toUpperCase());
    if (user.totpRecoveryHashes.includes(hash)) {
      await this.prisma.db.user.update({
        where: { id: userId },
        data: { totpRecoveryHashes: user.totpRecoveryHashes.filter((h) => h !== hash) },
      });
      this.logger.warn(`Recovery code used for user ${userId}`);
      return true;
    }
    return false;
  }

  private async checkCode(secret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    try {
      const result = await verify({ secret, token: code, epochTolerance: 30 });
      return result.valid;
    } catch {
      return false;
    }
  }
}
