import { Body, Controller, Delete, ForbiddenException, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  featureFlagsTenantParam,
  featureFlagsTenantQuery,
  featureFlagsUpdateSchema,
} from '@uzanite/contracts';
import { CurrentUser } from '../../decorators/principal.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { FeatureFlagsService } from './feature-flags.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal?.platformRole) throw new ForbiddenException('Platform admin only');
}

@ApiTags('admin')
@ApiBearerAuth()
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin:flags', scope: 'user' })
@Controller('admin/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  // Tenant-facing: effective flags for the caller's own tenant.
  @Get('me')
  async me(@CurrentUser() principal: Principal) {
    if (!principal?.tenantId) return { success: true, flags: {} };
    return { success: true, flags: await this.flags.effectiveWithMessages(principal.tenantId) };
  }

  // Admin: global flags (+ tenant overrides when `tenantId` is supplied).
  @UseGuards(AdminMfaGuard)
  @Get()
  list(@CurrentUser() principal: Principal, @Query(new ZodValidationPipe(featureFlagsTenantQuery)) query: { tenantId?: string }) {
    assertPlatformAdmin(principal);
    return this.flags.listForAdmin(query.tenantId);
  }

  @UseGuards(AdminMfaGuard)
  @Put()
  updateGlobal(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(featureFlagsUpdateSchema)) body: unknown
  ) {
    assertPlatformAdmin(principal);
    return this.flags.updateGlobal(body as never);
  }

  @UseGuards(AdminMfaGuard)
  @Put(':tenantId')
  updateTenant(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(featureFlagsTenantParam)) params: { tenantId: string },
    @Body(new ZodValidationPipe(featureFlagsUpdateSchema)) body: unknown
  ) {
    assertPlatformAdmin(principal);
    return this.flags.updateTenant(params.tenantId, body as never);
  }

  @UseGuards(AdminMfaGuard)
  @Delete(':tenantId')
  resetTenant(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(featureFlagsTenantParam)) params: { tenantId: string }
  ) {
    assertPlatformAdmin(principal);
    return this.flags.resetTenant(params.tenantId);
  }
}
