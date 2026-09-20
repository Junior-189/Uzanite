import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { confirmManualPaymentSchema, orderIdParam } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';

// Preserves the Phase M4 route `POST /api/v1/orders/:id/confirm-payment`, now
// settled through Finance so a Payment + Ledger entry are always written.
@ApiTags('orders')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'order-payments', scope: 'tenant' })
@Controller('orders')
export class OrderPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/confirm-payment')
  @RequirePermission('payments')
  confirmPayment(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(confirmManualPaymentSchema)) body: unknown
  ) {
    const actor =
      principal.role === 'owner' || principal.role === 'manager' ? principal.name || 'Owner' : principal.name || principal.userId;
    return this.payments.confirmManual(tenantId, params.id, body as never, actor);
  }
}
