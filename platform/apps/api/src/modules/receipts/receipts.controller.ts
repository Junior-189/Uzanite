import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listReceiptsQuery, orderReceiptParam, receiptIdParam } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ReceiptsService } from './receipts.service';

@ApiTags('receipts')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'receipts', scope: 'tenant' })
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('order/:orderId')
  @RequirePermission('receipts')
  byOrder(@TenantId() tenantId: string, @Param(new ZodValidationPipe(orderReceiptParam)) params: { orderId: string }) {
    return this.receipts.getByOrder(tenantId, params.orderId);
  }

  @Post('order/:orderId')
  @RequirePermission('receipts')
  generate(@TenantId() tenantId: string, @Param(new ZodValidationPipe(orderReceiptParam)) params: { orderId: string }) {
    return this.receipts.generateForOrder(tenantId, params.orderId);
  }

  @Get()
  @RequirePermission('receipts')
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listReceiptsQuery)) query: unknown) {
    return this.receipts.list(tenantId, query as never);
  }

  @Get(':id/html')
  @RequirePermission('receipts')
  @Header('Content-Type', 'text/html; charset=utf-8')
  html(@TenantId() tenantId: string, @Param(new ZodValidationPipe(receiptIdParam)) params: { id: string }) {
    return this.receipts.renderHtml(tenantId, params.id);
  }

  @Get(':id')
  @RequirePermission('receipts')
  get(@TenantId() tenantId: string, @Param(new ZodValidationPipe(receiptIdParam)) params: { id: string }) {
    return this.receipts.get(tenantId, params.id);
  }
}
