import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { activityLogsQuery, loginAttemptsQuery } from '@uzanite/contracts';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { AdminLogsService } from './admin-logs.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal?.platformRole) throw new ForbiddenException('Platform admin only');
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminMfaGuard)
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin:logs', scope: 'user' })
@Controller('admin')
export class AdminLogsController {
  constructor(private readonly logs: AdminLogsService) {}

  @Get('activity-logs/summary')
  activitySummary(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    return this.logs.activitySummary();
  }

  @Get('activity-logs')
  activityLogs(@CurrentUser() principal: Principal, @Query(new ZodValidationPipe(activityLogsQuery)) query: unknown) {
    assertPlatformAdmin(principal);
    return this.logs.activityLogs(query as never);
  }


  @Get('login-attempts/summary')
  loginSummary(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    return this.logs.loginSummary();
  }

  @Get('login-attempts')
  loginAttempts(@CurrentUser() principal: Principal, @Query(new ZodValidationPipe(loginAttemptsQuery)) query: unknown) {
    assertPlatformAdmin(principal);
    return this.logs.loginAttempts(query as never);
  }
}
