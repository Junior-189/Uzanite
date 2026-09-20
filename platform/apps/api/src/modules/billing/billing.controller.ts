import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TenantId } from '../../decorators/principal.decorator';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { BillingService } from './billing.service';

@ApiTags('billing')
@ApiBearerAuth()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'billing', scope: 'tenant' })
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @RequireTenant()
  @Get('status')
  async status(@TenantId() tenantId: string) {
    return { success: true, billing: await this.billing.getStatus(tenantId) };
  }
}
