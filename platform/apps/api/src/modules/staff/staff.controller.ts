import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  createStaffSchema,
  resetStaffPasswordSchema,
  staffIdParam,
  staffLoginSchema,
  updateStaffSchema,
} from '@uzanite/contracts';
import { Public } from '../../decorators/public.decorator';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { StaffService, StaffRequestMeta } from './staff.service';

function metaOf(req: Request): StaffRequestMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('staff')
@ApiBearerAuth()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'staff', scope: 'ip' })
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  private assertManager(principal: Principal): void {
    const allowed = principal.platformRole === 'super_admin' || principal.role === 'owner' || principal.role === 'manager';
    if (!allowed) throw new ForbiddenException('Access denied');
  }

  @Public()
  @Post('login')
  login(@Body(new ZodValidationPipe(staffLoginSchema)) body: unknown, @Req() req: Request) {
    return this.staff.login(body as never, metaOf(req));
  }

  @RequireTenant()
  @Get('me')
  me(@TenantId() tenantId: string, @CurrentUser() principal: Principal) {
    return this.staff.me(tenantId, principal.userId);
  }

  @RequireTenant()
  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() principal: Principal) {
    this.assertManager(principal);
    return this.staff.list(tenantId);
  }

  @RequireTenant()
  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(createStaffSchema)) body: unknown
  ) {
    this.assertManager(principal);
    return this.staff.create(tenantId, body as never, principal.userId);
  }

  @RequireTenant()
  @Put(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(staffIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(updateStaffSchema)) body: unknown
  ) {
    this.assertManager(principal);
    return this.staff.update(tenantId, params.id, body as never);
  }

  @RequireTenant()
  @Put(':id/reset-password')
  resetPassword(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(staffIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(resetStaffPasswordSchema)) body: { password: string }
  ) {
    this.assertManager(principal);
    return this.staff.resetPassword(tenantId, params.id, body as never);
  }

  @RequireTenant()
  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(staffIdParam)) params: { id: string }
  ) {
    this.assertManager(principal);
    return this.staff.remove(tenantId, params.id);
  }
}
