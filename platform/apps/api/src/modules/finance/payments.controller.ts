import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  confirmManualPaymentSchema,
  initiatePaymentSchema,
  listPaymentsQuery,
  orderIdParam,
  paymentIdParam,
  refundPaymentSchema,
} from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { NoRequestTransaction } from '../../decorators/no-request-transaction.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'payments', scope: 'tenant' })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  private actor(principal: Principal): string {
    if (principal.role === 'owner' || principal.role === 'manager') return principal.name || 'Owner';
    return principal.name || principal.userId;
  }

  @Get('providers')
  providers() {
    return { success: true, providers: this.payments.providers() };
  }

  @Get('orders/:id')
  @RequirePermission('payments')
  listForOrder(@TenantId() tenantId: string, @Param(new ZodValidationPipe(orderIdParam)) params: { id: string }) {
    return this.payments.listForOrder(tenantId, params.id);
  }

  @Get()
  @RequirePermission('payments')
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listPaymentsQuery)) query: unknown) {
    return this.payments.list(tenantId, query as never);
  }

  @Get(':id')
  @RequirePermission('payments')
  get(@TenantId() tenantId: string, @Param(new ZodValidationPipe(paymentIdParam)) params: { id: string }) {
    return this.payments.get(tenantId, params.id);
  }

  @Post('orders/:id/initiate')
  @RequirePermission('payments')
  @NoRequestTransaction()
  initiate(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(initiatePaymentSchema)) body: unknown
  ) {
    return this.payments.initiate(tenantId, params.id, body as never, this.actor(principal));
  }

  @Post('orders/:id/manual')
  @RequirePermission('payments')
  confirmManual(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(confirmManualPaymentSchema)) body: unknown
  ) {
    return this.payments.confirmManual(tenantId, params.id, body as never, this.actor(principal));
  }

  @Post(':id/refund')
  @RequirePermission('payments')
  refund(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(paymentIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(refundPaymentSchema)) body: unknown
  ) {
    return this.payments.refund(tenantId, params.id, body as never, this.actor(principal));
  }
}
