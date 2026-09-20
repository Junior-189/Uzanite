import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  adminTenantIdParam,
  listTenantsQuery,
  rejectTenantSchema,
  setPlanSchema,
  suspendTenantSchema,
} from '@uzanite/contracts';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AdminService } from './admin.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal.platformRole) throw new ForbiddenException('Platform admin only');
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminMfaGuard)
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin', scope: 'user' })
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('tenants')
  listTenants(@CurrentUser() principal: Principal, @Query(new ZodValidationPipe(listTenantsQuery)) query: unknown) {
    assertPlatformAdmin(principal);
    return this.admin.listTenants(query as never);
  }

  @Get('tenants/:id/users')
  listUsers(@CurrentUser() principal: Principal, @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string }) {
    assertPlatformAdmin(principal);
    return this.admin.listUsers(id);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: 'admin:lifecycle', scope: 'user' })
  @Put('tenants/:id/approve')
  approve(@CurrentUser() principal: Principal, @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string }) {
    assertPlatformAdmin(principal);
    return this.admin.approve(id);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: 'admin:lifecycle', scope: 'user' })
  @Put('tenants/:id/reject')
  reject(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(rejectTenantSchema)) body: { reason: string }
  ) {
    assertPlatformAdmin(principal);
    return this.admin.reject(id, body.reason);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: 'admin:lifecycle', scope: 'user' })
  @Put('tenants/:id/suspend')
  suspend(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(suspendTenantSchema)) body: { suspended: boolean }
  ) {
    assertPlatformAdmin(principal);
    return this.admin.setSuspended(id, body.suspended);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: 'admin:lifecycle', scope: 'user' })
  @Put('tenants/:id/plan')
  setPlan(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(setPlanSchema)) body: unknown
  ) {
    assertPlatformAdmin(principal);
    return this.admin.setPlan(id, body as never);
  }

  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'admin:impersonate', scope: 'user' })
  @Post('tenants/:id/impersonate')
  impersonate(@CurrentUser() principal: Principal, @Param(new ZodValidationPipe(adminTenantIdParam)) { id }: { id: string }, @Req() req: Request) {
    assertPlatformAdmin(principal);
    return this.admin.impersonate(id, principal.userId, req.ip, req.headers['user-agent'] as string | undefined);
  }
}
