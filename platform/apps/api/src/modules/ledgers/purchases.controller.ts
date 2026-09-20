import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { idParam, listPurchasesQuery, purchaseCreateSchema, purchaseUpdateSchema } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('purchases')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'purchases', scope: 'tenant' })
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listPurchasesQuery)) query: unknown) {
    return this.purchases.list(tenantId, query as never);
  }

  @Post()
  @UseInterceptors(FileInterceptor('receipt'))
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(purchaseCreateSchema)) body: unknown,
    @UploadedFile() receipt?: { buffer: Buffer; originalname?: string }
  ) {
    return this.purchases.create(tenantId, body as never, principal, receipt);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('receipt'))
  update(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(idParam)) params: { id: string },
    @Body(new ZodValidationPipe(purchaseUpdateSchema)) body: unknown,
    @UploadedFile() receipt?: { buffer: Buffer; originalname?: string }
  ) {
    return this.purchases.update(tenantId, params.id, body as never, receipt);
  }

  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(idParam)) params: { id: string }
  ) {
    return this.purchases.remove(tenantId, params.id, principal.userId);
  }
}
