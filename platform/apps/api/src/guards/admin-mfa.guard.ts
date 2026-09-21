import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { getRequestStore } from '../context/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Requires platform admins (super_admin / sub_admin) to have TOTP two-factor
 * enabled before they can use admin endpoints. Non-admin users pass through
 * (they are rejected downstream by the admin-only checks).
 *
 * Applied at the controller level on `AdminController`; it runs after the global
 * JwtAuthGuard, so `principal.userId` is already authenticated.
 */
@Injectable()
export class AdminMfaGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const principal = getRequestStore()?.principal;
    if (!principal?.platformRole) return true;

    const user = await this.prisma.db.user.findFirst({
      where: { id: principal.userId },
      select: { totpEnabledAt: true },
    });
    if (!user?.totpEnabledAt) {
      throw new ForbiddenException({
        success: false,
        code: 'mfa_setup_required',
        error:
          'Two-factor authentication is required for platform admins. Enroll via POST /api/v1/auth/totp/enroll.',
      });
    }
    return true;
  }
}
