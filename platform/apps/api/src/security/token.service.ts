import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../ids/id';
import { randomToken, sha256 } from '../crypto/crypto';

export interface AccessTokenClaims {
  userId: string;
  tenantId?: string | null;
  membershipId?: string | null;
  role?: string | null;
  permissions?: string[];
  tokenVersion: number;
  impersonatedBy?: string | null;
}

interface RefreshMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  private get refreshTtlMs(): number {
    const days = this.config.get<number>('JWT_REFRESH_TTL_DAYS') ?? 30;
    return days * 24 * 60 * 60 * 1000;
  }

  signAccess(claims: AccessTokenClaims, ttl?: string): Promise<string> {
    const payload = {
      sub: claims.userId,
      // `id` mirrors the legacy Express claim so both apps can decode the same
      // token shape during the Strangler transition (see M2 gate C4).
      id: claims.userId,
      tid: claims.tenantId ?? null,
      mid: claims.membershipId ?? null,
      role: claims.role ?? null,
      perms: claims.permissions ?? [],
      tv: claims.tokenVersion,
      act: claims.impersonatedBy ?? null,
    };
    return ttl ? this.jwt.signAsync(payload, { expiresIn: ttl }) : this.jwt.signAsync(payload);
  }

  async issueRefresh(userId: string, meta: RefreshMeta = {}): Promise<string> {
    const raw = randomToken(48);
    await this.prisma.db.refreshToken.create({
      data: {
        id: newId(),
        userId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return raw;
  }

  // Rotates a refresh token. Reuse of a revoked token revokes the whole family.
  async rotateRefresh(raw: string, meta: RefreshMeta = {}): Promise<{ userId: string; refreshToken: string } | null> {
    const hash = sha256(raw);
    const existing = await this.prisma.db.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!existing) return null;

    if (existing.revokedAt) {
      await this.prisma.db.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    if (existing.expiresAt < new Date()) return null;

    const newRaw = randomToken(48);
    const newHash = sha256(newRaw);
    await this.prisma.db.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: newHash },
    });
    await this.prisma.db.refreshToken.create({
      data: {
        id: newId(),
        userId: existing.userId,
        tokenHash: newHash,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { userId: existing.userId, refreshToken: newRaw };
  }

  async revoke(raw: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { tokenHash: sha256(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
