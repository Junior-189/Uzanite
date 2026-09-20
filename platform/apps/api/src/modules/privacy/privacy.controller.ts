import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  consentSchema,
  listPrivacyRequestsQuery,
  privacyEraseSchema,
  privacyExportQuery,
  type ConsentInput,
  type ListPrivacyRequestsQuery,
  type PrivacyEraseInput,
  type PrivacyExportQuery,
} from '@uzanite/contracts';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { Principal } from '../../context/tenant-context';
import { PrivacyService } from './privacy.service';

/**
 * Data-subject rights endpoints (PDPA 2022).
 *
 * `manage_business` is required: exporting or erasing customer data is an
 * owner/manager action, not something counter staff should be able to trigger.
 * Rate limits are deliberately low — these are heavy, rare, sensitive calls,
 * and the export endpoint is an obvious bulk-exfiltration target.
 */
@ApiTags('privacy')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 10, windowSeconds: 3600, keyPrefix: 'privacy', scope: 'tenant' })
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  private actor(principal: Principal | null, req: Request) {
    return {
      userId: principal?.userId ?? 'unknown',
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
    };
  }

  @Get('export')
  @RequirePermission('manage_business')
  export(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal | null,
    @Req() req: Request,
    @Query(new ZodValidationPipe(privacyExportQuery)) query: PrivacyExportQuery
  ) {
    return this.privacy.exportData(tenantId, query, this.actor(principal, req));
  }

  @Post('erase')
  @RequirePermission('manage_business')
  erase(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal | null,
    @Req() req: Request,
    @Body(new ZodValidationPipe(privacyEraseSchema)) body: PrivacyEraseInput
  ) {
    return this.privacy.erase(tenantId, body, this.actor(principal, req));
  }

  @Post('consent')
  @RequirePermission('contacts')
  consent(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal | null,
    @Req() req: Request,
    @Body(new ZodValidationPipe(consentSchema)) body: ConsentInput
  ) {
    return this.privacy.setConsent(tenantId, body, this.actor(principal, req));
  }

  @Get('requests')
  @RequirePermission('manage_business')
  listRequests(
    @TenantId() tenantId: string,
    @Query(new ZodValidationPipe(listPrivacyRequestsQuery)) query: ListPrivacyRequestsQuery
  ) {
    return this.privacy.listRequests(tenantId, query);
  }
}
