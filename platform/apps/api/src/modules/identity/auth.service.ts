import {
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
import { hashPassword, assertPasswordPolicy, verifyPassword } from '../../security/password';
import { newId } from '../../ids/id';
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
    private readonly config: ConfigService
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

    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      await this.recordLogin(input.email, user.id, 'failed', 'Wrong password', meta);
      await this.lockout.recordFailure(input.email);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === 'rejected') throw new ForbiddenException('Your account has been rejected. Contact support.');
    if (user.status === 'suspended') throw new ForbiddenException('Your account has been suspended. Contact support.');

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

    await this.lockout.clear(input.email);
    await this.recordLogin(input.email, user.id, pending ? 'pending' : 'success', pending ? 'Account pending approval' : '', meta);

    return {
      success: true,
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

  async refresh(raw: string, meta: RequestMeta) {
    const rotated = await this.tokens.rotateRefresh(raw, meta);
    if (!rotated) throw new UnauthorizedException('Invalid or expired session');

    const user = await this.prisma.db.user.findFirst({ where: { id: rotated.userId, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Account not found');
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

    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
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
      select: { id: true, name: true, email: true, phone: true, platformRole: true, status: true, mustChangePassword: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const membership = await runAsSystem(() =>
      this.prisma.db.membership.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'asc' },
        include: { tenant: { select: { id: true, slug: true, name: true, status: true } } },
      })
    );
    return {
      success: true,
      user: {
        ...user,
        tenantId: membership?.tenantId ?? null,
        role: membership?.role ?? null,
        permissions: membership?.permissions ?? [],
        tenant: membership?.tenant ?? null,
      },
    };
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
