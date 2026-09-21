import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../context/tenant-context';
import { PrivacyService } from '../privacy/privacy.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal?.platformRole) throw new ForbiddenException('Platform admin only');
}

// Admin data-rights operations (legacy `/admin/privacy`).
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminMfaGuard)
@RateLimit({ limit: 20, windowSeconds: 3600, keyPrefix: 'admin:privacy', scope: 'user' })
@Controller('admin/privacy')
export class AdminPrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly prisma: PrismaService
  ) {}

  @Get('tenants/:id/export')
  async exportTenant(@CurrentUser() principal: Principal, @Param('id') id: string, @Req() req: Request) {
    assertPlatformAdmin(principal);
    const tenant = await runAsSystem(() => this.prisma.db.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } }));
    if (!tenant) throw new NotFoundException('Tenant not found');
    return runAsSystem(() =>
      this.privacy.exportData(id, {} as never, {
        userId: principal.userId,
        ip: req.ip ?? null,
        userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
      })
    );
  }

}
