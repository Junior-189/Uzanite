import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createOrderSchema,
  listOrdersQuery,
  orderIdParam,
  orderNoteSchema,
  orderNumberParam,
  rejectOrderSchema,
} from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { EnforceLimit, RequirePlanFeature } from '../../decorators/plan.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@RequireTenant()
@RequirePlanFeature('orders')
@RateLimit({ limit: 180, windowSeconds: 60, keyPrefix: 'orders', scope: 'tenant' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  private actor(principal: Principal, override?: string): string {
    if (override?.trim()) return override.trim();
    if (principal.role === 'owner' || principal.role === 'manager') return principal.name || 'Owner';
    return principal.name || principal.userId;
  }

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listOrdersQuery)) query: unknown) {
    return this.orders.list(tenantId, query as never);
  }

  @Get('by-number/:orderNumber')
  byNumber(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(orderNumberParam)) params: { orderNumber: string }
  ) {
    return this.orders.getByNumber(tenantId, params.orderNumber);
  }

  @Get(':id/history')
  history(@TenantId() tenantId: string, @Param(new ZodValidationPipe(orderIdParam)) params: { id: string }) {
    return this.orders.history(tenantId, params.id);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param(new ZodValidationPipe(orderIdParam)) params: { id: string }) {
    return this.orders.get(tenantId, params.id);
  }

  @Post()
  @RequirePermission('orders')
  @EnforceLimit('ordersPerMonth')
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(createOrderSchema)) body: { recordedBy?: string } & Record<string, unknown>
  ) {
    return this.orders.create(tenantId, body as never, this.actor(principal, body.recordedBy));
  }

  @Post('manual')
  @RequirePermission('orders')
  @EnforceLimit('ordersPerMonth')
  createManual(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(createOrderSchema)) body: { recordedBy?: string } & Record<string, unknown>
  ) {
    return this.orders.createManual(tenantId, body as never, this.actor(principal, body.recordedBy));
  }

  @Post(':id/approve')
  @RequirePermission('orders')
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(orderNoteSchema)) body: { note: string }
  ) {
    return this.orders.approve(tenantId, params.id, body.note, this.actor(principal));
  }

  @Post(':id/reject')
  @RequirePermission('orders')
  reject(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(rejectOrderSchema)) body: { reason: string }
  ) {
    return this.orders.reject(tenantId, params.id, body.reason, this.actor(principal));
  }

  @Post(':id/request-payment')
  @RequirePermission('orders')
  requestPayment(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string }
  ) {
    return this.orders.requestPayment(tenantId, params.id, this.actor(principal));
  }

  // NOTE: `POST /orders/:id/confirm-payment` is handled by Finance
  // (OrderPaymentsController) so a Payment + Ledger entry are always written.

  @Post(':id/deliver')
  @RequirePermission('orders')
  deliver(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(orderNoteSchema)) body: { note: string }
  ) {
    return this.orders.deliver(tenantId, params.id, body.note, this.actor(principal));
  }

  @Delete(':id')
  @RequirePermission('orders')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string },
    @Query('permanent') permanent?: string
  ) {
    return this.orders.remove(tenantId, params.id, this.actor(principal), permanent === 'true', principal.userId);
  }

  @Put(':id/restore')
  @RequirePermission('orders')
  restore(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(orderIdParam)) params: { id: string }
  ) {
    return this.orders.restore(tenantId, params.id, this.actor(principal));
  }
}
