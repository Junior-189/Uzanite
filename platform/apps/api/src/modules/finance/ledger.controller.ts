import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listLedgerQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { LedgerService } from './ledger.service';

@ApiTags('ledger')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: 'ledger', scope: 'tenant' })
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('summary')
  @RequirePermission('payments')
  async summary(@TenantId() tenantId: string) {
    return { success: true, summary: await this.ledger.summary(tenantId) };
  }

  /** Double-entry reconciliation invariant + trial balance. */
  @Get('reconciliation')
  @RequirePermission('payments')
  async reconciliation(@TenantId() tenantId: string) {
    return { success: true, reconciliation: await this.ledger.reconcile(tenantId) };
  }

  @Get()
  @RequirePermission('payments')
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listLedgerQuery)) query: unknown) {
    return this.ledger.list(tenantId, query as never);
  }
}
