import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { dashboardQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: 'dashboard' })
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  stats(@TenantId() tenantId: string, @Query(new ZodValidationPipe(dashboardQuery)) query: unknown) {
    return this.dashboard.stats(tenantId, query as never);
  }
}
