import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChangePasswordInput, LoginInput, RegisterInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../../security/token.service';
import { LockoutService } from '../../security/lockout.service';
import { TotpService } from '../../security/totp.service';
import { hashPassword, assertPasswordPolicy, verifyPasswordDetailed } from '../../security/password';
import { newId } from '../../ids/id';
import { blindIndex, decryptPii } from '../../security/pii';
import { randomToken, sha256 } from '../../crypto/crypto';
import { runAsSystem } from '../../context/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly totp: TotpService
  ) {}

  private async recordLogin(
    email: string,
    userId: string | null,
    status: string,
    reason: string,
    meta: RequestMeta
  ): Promise<void> {
    await this.prisma.db.loginAttempt.create({
      data: { email, userId, status, reason, ip: meta.ip, userAgent: meta.userAgent },
    });
  }

  async register(input: RegisterInput) {
    assertPasswordPolicy(input.password);
    const existing = await this.prisma.db.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('Email already registered');

    const tenantId = newId();
    const userId = newId();
    const slug = `biz_${randomToken(6)}`;
    const passwordHash = await hashPassword(input.password);

    await runAsSystem(() =>
      this.prisma.transaction(async (tx) => {
        await tx.tenant.create({
          data: { id: tenantId, slug, name: input.businessName || `${input.name}'s Shop`, status: 'pending' },
        });
        await tx.tenantSettings.create({ data: { tenantId } });
        await tx.user.create({
          data: {
            id: userId,
            email: input.email,
            name: input.name,
            phone: input.phone || null,
            passwordHash,
            status: 'pending',
          },
        });
        await tx.membership.create({
          data: { id: newId(), userId, tenantId, role: 'owner', status: 'active' },
        });
        await tx.subscription.create({
          data: { id: newId(), tenantId, planKey: 'free', status: 'active' },
        });
      })
    );

    return {
      success: true,
      pending: true,
      message: 'Registration successful. Your account is pending admin approval.',
      user: { id: userId, email: input.email, tenantId, slug, status: 'pending' },
    };
  }

  // Issues an authenticated session (access + refresh token) for a user.
  private async issueSession(
    user: {
      id: string;
      name: string;
      email: string;
      platformRole: string | null;
      status: string;
      mustChangePassword: boolean;
      tokenVersion: number;
    },
    meta: RequestMeta
  ) {
    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({
        where: { userId: user.id, status: 'active' },
        orderBy: { createdAt: 'asc' },
      })
    );

    const pending = user.status === 'pending';
    const accessToken = await this.tokens.signAccess({
      userId: user.id,
      tenantId: membership?.tenantId ?? null,
      membershipId: membership?.id ?? null,
      role: membership?.role ?? null,
      permissions: membership?.permissions ?? [],
      tokenVersion: user.tokenVersion,
    });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);

    return {
      success: true as const,
      pending,
      token: accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
        tenantId: membership?.tenantId ?? null,
        role: membership?.role ?? null,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async login(input: LoginInput, meta: RequestMeta) {
    const lock = await this.lockout.check(input.email);
    if (lock.locked) {
      const remaining = (lock.lockedUntil ?? Date.now()) - Date.now();
      throw new HttpException(
        {
          success: false,
          error: `Too many failed attempts. Please wait ${Math.ceil(remaining / 60000)} minute(s).`,
          lockout: true,
          retryAfter: Math.ceil(remaining / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const user = await this.prisma.db.user.findFirst({ where: { email: input.email, deletedAt: null } });
    if (!user) {
      await this.recordLogin(input.email, null, 'failed', 'User not found', meta);
      await this.lockout.recordFailure(input.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    const verification = await verifyPasswordDetailed(input.password, user.passwordHash);
    if (!verification.valid) {
      await this.recordLogin(input.email, user.id, 'failed', 'Wrong password', meta);
      await this.lockout.recordFailure(input.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Transparently upgrade legacy bcrypt (or outdated argon2) hashes to argon2id.
    if (verification.needsRehash) {
      const passwordHash = await hashPassword(input.password);
      await this.prisma.db.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    if (user.status === 'rejected') throw new ForbiddenException('Your account has been rejected. Contact support.');
    if (user.status === 'suspended') throw new ForbiddenException('Your account has been suspended. Contact support.');

    // Two-factor: hand back a short-lived challenge instead of a session.
    if (user.totpEnabledAt) {
      const mfaToken = await this.tokens.signMfaChallenge(user.id, user.tokenVersion);
      await this.recordLogin(input.email, user.id, 'mfa_required', 'Awaiting 2FA code', meta);
      return { success: false as const, mfaRequired: true as const, mfaToken };
    }

    await this.lockout.clear(input.email);
    const pending = user.status === 'pending';
    await this.recordLogin(input.email, user.id, pending ? 'pending' : 'success', pending ? 'Account pending approval' : '', meta);
    return this.issueSession(user, meta);
  }

  // Second step of the two-factor login: exchange the mfa challenge + code.
  async loginMfa(mfaToken: string, code: string, meta: RequestMeta) {
    const challenge = await this.tokens.verifyMfaChallenge(mfaToken);
    if (!challenge) throw new UnauthorizedException('Invalid or expired two-factor challenge');

    const user = await this.prisma.db.user.findFirst({ where: { id: challenge.userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Account not found');
    if (user.status === 'suspended' || user.status === 'rejected') throw new ForbiddenException('Account is not active');
    if (user.tokenVersion !== challenge.tokenVersion) throw new UnauthorizedException('Session expired. Please sign in again.');

    if (!(await this.totp.verifyForUser(user.id, code))) {
      await this.recordLogin(user.email, user.id, 'failed', 'Invalid 2FA code', meta);
      throw new UnauthorizedException('Invalid authentication code');
    }

    await this.recordLogin(user.email, user.id, user.status === 'pending' ? 'pending' : 'success', '2FA verified', meta);
    return this.issueSession(user, meta);
  }

  // ── TOTP two-factor management ───────────────────────────────────────────────
  // Step-up: enrolling an authenticator requires the account password, so a
  // stolen session alone cannot bind a new second factor.
  async beginTotp(userId: string, password: string) {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('User not found');
    const verification = await verifyPasswordDetailed(password, user.passwordHash);
    if (!verification.valid) throw new UnauthorizedException('Password is incorrect');
    return this.totp.beginEnrollment(userId);
  }

  confirmTotp(userId: string, code: string) {
    return this.totp.confirmEnrollment(userId, code);
  }

  async disableTotp(userId: string, password: string, code: string) {
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('User not found');
    const verification = await verifyPasswordDetailed(password, user.passwordHash);
    if (!verification.valid) throw new UnauthorizedException('Password is incorrect');
    if (!(await this.totp.verifyForUser(userId, code))) throw new UnauthorizedException('Invalid authentication code');
    return this.totp.disable(userId);
  }

  async refresh(raw: string, meta: RequestMeta) {
    const rotated = await this.tokens.rotateRefresh(raw, meta);
    if (!rotated) throw new UnauthorizedException('Invalid or expired session');

    const user =
      rotated.principalType === 'staff'
        ? null
        : await this.prisma.db.user.findFirst({ where: { id: rotated.userId, deletedAt: null } });
    if (!user) {
      // Staff sessions use the same refresh-token table with
      // principalType='staff'. Re-issue a `type: 'staff'` access token.
      const staff = await runAsSystem(() =>
        this.prisma.db.staff.findFirst({
          where: { id: rotated.userId },
          select: { id: true, tenantId: true, permissions: true, tokenVersion: true, status: true },
        })
      );
      if (!staff) throw new UnauthorizedException('Account not found');
      if (staff.status !== 'active') {
        await this.tokens.revokeAllForUser(staff.id);
        throw new ForbiddenException('Account is not active');
      }
      const token = await this.tokens.signAccess({
        userId: staff.id,
        tenantId: staff.tenantId,
        membershipId: null,
        role: 'staff',
        permissions: staff.permissions,
        tokenVersion: staff.tokenVersion,
        type: 'staff',
      });
      return { success: true, token, refreshToken: rotated.refreshToken };
    }
    if (user.status === 'suspended' || user.status === 'rejected') {
      await this.tokens.revokeAllForUser(user.id);
      throw new ForbiddenException('Account is not active');
    }

    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({ where: { userId: user.id, status: 'active' }, orderBy: { createdAt: 'asc' } })
    );

    const token = await this.tokens.signAccess({
      userId: user.id,
      tenantId: membership?.tenantId ?? null,
      membershipId: membership?.id ?? null,
      role: membership?.role ?? null,
      permissions: membership?.permissions ?? [],
      tokenVersion: user.tokenVersion,
    });

    return { success: true, token, refreshToken: rotated.refreshToken };
  }

  async logout(raw?: string) {
    if (raw) await this.tokens.revoke(raw);
    return { success: true, message: 'Signed out' };
  }

  async changePassword(userId: string, input: ChangePasswordInput, meta: RequestMeta) {
    assertPasswordPolicy(input.newPassword);
    const user = await this.prisma.db.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('User not found');

    const ok = (await verifyPasswordDetailed(input.currentPassword, user.passwordHash)).valid;
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    });
    await this.tokens.revokeAllForUser(user.id);

    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({ where: { userId: user.id, status: 'active' }, orderBy: { createdAt: 'asc' } })
    );
    const token = await this.tokens.signAccess({
      userId: user.id,
      tenantId: membership?.tenantId ?? null,
      membershipId: membership?.id ?? null,
      role: membership?.role ?? null,
      permissions: membership?.permissions ?? [],
      tokenVersion: user.tokenVersion + 1,
    });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { success: true, message: 'Password updated', token, refreshToken };
  }

  async me(userId: string) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        platformRole: true,
        status: true,
        mustChangePassword: true,
        theme: true,
        createdAt: true,
        totpEnabledAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'asc' },
        include: { tenant: { select: { id: true, slug: true, name: true, status: true } } },
      })
    );
    const { totpEnabledAt, ...rest } = user;
    return {
      success: true,
      user: {
        ...rest,
        totpEnabled: !!totpEnabledAt,
        tenantId: membership?.tenantId ?? null,
        role: membership?.role ?? null,
        permissions: membership?.permissions ?? [],
        tenant: membership?.tenant ?? null,
      },
    };
  }

  /**
   * Google sign-in (legacy `/auth/google`). Verifies the Google ID token via
   * the tokeninfo endpoint (no SDK dependency, matching the legacy app), then:
   *   - staff emails resolve to a Staff account (avoids creating a tenant),
   *   - otherwise signs in / signs up a tenant user (new signups are pending).
   */
  async googleLogin(idToken: string, meta: RequestMeta) {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new HttpException({ success: false, error: 'Google login is not configured on the server' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    let payload: { sub?: string; email?: string; name?: string; picture?: string; aud?: string; exp?: number; iss?: string; email_verified?: boolean | string };
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      payload = (await res.json()) as typeof payload;
      if (!res.ok || !payload.sub) throw new Error('invalid');
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }
    if (payload.aud !== clientId) throw new UnauthorizedException('Token audience mismatch');
    if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
      throw new UnauthorizedException('Invalid Google token issuer');
    }
    if (!payload.exp || payload.exp * 1000 < Date.now()) throw new UnauthorizedException('Google token expired');
    // Never trust an unverified email: it is the account-linking key.
    if (payload.email_verified !== true && payload.email_verified !== 'true') {
      throw new UnauthorizedException('Google account email is not verified');
    }

    const email = (payload.email || '').toLowerCase();
    if (!email) throw new BadRequestException('Google account has no email');
    const name = payload.name || email.split('@')[0];

    // ── Staff by email ──
    const staff = await runAsSystem(() =>
      this.prisma.db.staff.findFirst({ where: { OR: [{ emailIdx: blindIndex(email) }, { email }] } })
    );
    if (staff) {
      if (staff.status !== 'active') throw new ForbiddenException('Account is inactive. Contact your manager.');
      await runAsSystem(() => this.prisma.db.staff.update({ where: { id: staff.id }, data: { lastLogin: new Date() } }));
      const token = await this.tokens.signAccess({
        userId: staff.id,
        tenantId: staff.tenantId,
        membershipId: null,
        role: 'staff',
        permissions: staff.permissions,
        tokenVersion: staff.tokenVersion,
        type: 'staff',
      });
      const refreshToken = await this.tokens.issueRefresh(staff.id, meta, 'staff');
      return {
        success: true,
        token,
        refreshToken,
        user: { _id: staff.id, name: staff.name, email: decryptPii(staff.email), role: 'staff', permissions: staff.permissions, businessId: staff.tenantId, avatar: '' },
      };
    }

    // ── Tenant / admin user ──
    let user = await this.prisma.db.user.findFirst({ where: { email, deletedAt: null } });
    let isNew = false;
    if (!user) {
      const tenantId = newId();
      const userId = newId();
      await runAsSystem(() =>
        this.prisma.transaction(async (tx) => {
          await tx.tenant.create({ data: { id: tenantId, slug: `biz_${randomToken(6)}`, name: `${name}'s Shop`, status: 'pending' } });
          await tx.tenantSettings.create({ data: { tenantId } });
          await tx.user.create({
            data: { id: userId, email, name, avatarUrl: payload.picture ?? null, authProvider: 'google', status: 'pending' },
          });
          await tx.membership.create({ data: { id: newId(), userId, tenantId, role: 'owner', status: 'active' } });
          await tx.subscription.create({ data: { id: newId(), tenantId, planKey: 'free', status: 'active' } });
        })
      );
      user = await this.prisma.db.user.findFirst({ where: { id: userId } });
      isNew = true;
    } else if (!user.avatarUrl || user.authProvider !== 'google') {
      await runAsSystem(() =>
        this.prisma.db.user.update({
          where: { id: user!.id },
          data: { avatarUrl: user!.avatarUrl || payload.picture || null, authProvider: user!.passwordHash ? user!.authProvider : 'google' },
        })
      );
    }
    if (!user) throw new UnauthorizedException('Google sign-in failed');
    if (user.status === 'rejected') throw new ForbiddenException('Your account has been rejected. Contact support.');
    if (user.status === 'suspended') throw new ForbiddenException('Your account has been suspended. Contact support.');

    await this.recordLogin(email, user.id, 'success', 'Google sign-in', meta);
    const session = await this.issueSession(user, meta);
    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({
        where: { userId: user!.id, status: 'active' },
        orderBy: { createdAt: 'asc' },
        include: { tenant: { select: { id: true, name: true } } },
      })
    );
    return {
      ...session,
      user: {
        ...session.user,
        businessId: membership?.tenantId ?? null,
        businessName: membership?.tenant?.name ?? null,
        theme: user.theme,
        avatar: user.avatarUrl ?? '',
      },
      ...(session.pending ? { message: isNew ? 'Registration successful! Your account is pending admin approval.' : 'Your account is pending admin approval. Please wait for approval.' } : {}),
    };
  }

  /** Persists the tenant user's UI theme preference (legacy `/auth/theme`). */
  async setTheme(userId: string, theme: 'light' | 'dark') {
    await this.prisma.db.user.update({ where: { id: userId }, data: { theme } });
    return { success: true, theme };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.db.user.findFirst({ where: { email, deletedAt: null } });
    // Always return success to avoid account enumeration.
    if (!user) return { success: true, message: 'If that email exists, a reset link has been sent.' };

    const raw = randomToken(32);
    await this.prisma.db.passwordResetToken.create({
      data: {
        id: newId(),
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Transactional outbox: the worker sends the email after commit.
    const appUrl = this.config.get<string>('APP_URL') ?? 'http://localhost:4000';
    const link = `${appUrl}/reset-password?token=${raw}`;
    await this.outbox.enqueue({
      type: 'email.send',
      payload: {
        to: user.email,
        subject: 'Reset your UZANITE password',
        html: `<h2>Password Reset</h2><p>Hello ${user.name},</p><p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${link}">Reset password</a></p>`,
      },
    });

    return { success: true, message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    assertPasswordPolicy(newPassword);
    const record = await this.prisma.db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset link');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
      });
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });
    await this.tokens.revokeAllForUser(record.userId);
    return { success: true, message: 'Password reset successful. Please sign in.' };
  }
}
