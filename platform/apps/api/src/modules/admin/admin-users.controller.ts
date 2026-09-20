import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  adminUserEmailSchema,
  adminUserIdParam,
  adminUserNameSchema,
  adminUserRejectSchema,
  adminUserResetPasswordSchema,
  adminUserSuspendSchema,
  subAdminCreateSchema,
  subAdminUpdateSchema,
} from '@uzanite/contracts';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal.platformRole) throw new ForbiddenException('Platform admin only');
}

function assertSuperAdmin(principal: Principal): void {
  if (principal.platformRole !== 'super_admin') throw new ForbiddenException('Access denied. Super admin only.');
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminMfaGuard)
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin:users', scope: 'user' })
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get('users')
  listUsers(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    return this.adminUsers.listUsers();
  }

  @Get('stats')
  stats(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    return this.adminUsers.stats();
  }

  @Put('users/:id/approve')
  approve(@CurrentUser() principal: Principal, @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string }) {
    assertPlatformAdmin(principal);
    return this.adminUsers.approve(id);
  }

  @Put('users/:id/reject')
  reject(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserRejectSchema)) body: unknown
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.reject(id, body as never);
  }

  @Put('users/:id/suspend')
  suspend(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserSuspendSchema)) body: { suspended: boolean }
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.suspend(id, body.suspended);
  }

  @Put('users/:id/update-name')
  updateName(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserNameSchema)) body: { name: string }
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.updateName(id, body.name);
  }

  @Put('users/:id/update-email')
  updateEmail(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserEmailSchema)) body: { email: string }
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.updateEmail(id, body.email);
  }

  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: 'admin:reset', scope: 'user' })
  @Put('users/:id/reset-password')
  resetPassword(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserResetPasswordSchema)) body: { newPassword: string }
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.resetPassword(id, body.newPassword);
  }

  @Delete('users/:id')
  remove(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Query('permanent') permanent?: string
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.remove(id, permanent === 'true');
  }

  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: 'admin:impersonate', scope: 'user' })
  @Post('impersonate/:id')
  impersonate(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Req() req: Request
  ) {
    assertPlatformAdmin(principal);
    return this.adminUsers.impersonate(id, principal.userId, req.ip, req.headers['user-agent'] as string | undefined);
  }

  // ── Sub-admins (super-admin only) ──────────────────────────────────────────

  @Get('sub-admins')
  listSubAdmins(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    return this.adminUsers.listSubAdmins();
  }

  @Post('sub-admins')
  createSubAdmin(@CurrentUser() principal: Principal, @Body(new ZodValidationPipe(subAdminCreateSchema)) body: unknown) {
    assertSuperAdmin(principal);
    return this.adminUsers.createSubAdmin(body as never);
  }

  @Put('sub-admins/:id')
  updateSubAdmin(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(subAdminUpdateSchema)) body: unknown
  ) {
    assertSuperAdmin(principal);
    return this.adminUsers.updateSubAdmin(id, body as never);
  }

  @Delete('sub-admins/:id')
  removeSubAdmin(@CurrentUser() principal: Principal, @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string }) {
    assertSuperAdmin(principal);
    return this.adminUsers.removeSubAdmin(id);
  }

  @Put('sub-admins/:id/reset-password')
  resetSubAdminPassword(
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(adminUserIdParam)) { id }: { id: string },
    @Body(new ZodValidationPipe(adminUserResetPasswordSchema)) body: { newPassword: string }
  ) {
    assertSuperAdmin(principal);
    return this.adminUsers.resetSubAdminPassword(id, body.newPassword);
  }
}
