import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  createProductSchema,
  listProductsQuery,
  productIdParam,
  restockSchema,
  updateProductSchema,
} from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { EnforceLimit } from '../../decorators/plan.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: 'products', scope: 'tenant' })
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  private recordedBy(principal: Principal): string {
    if (principal.role === 'owner' || principal.role === 'manager') return principal.name || 'Owner';
    return principal.name || principal.userId;
  }

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listProductsQuery)) query: unknown) {
    return this.products.list(tenantId, query as never);
  }

  @Get('barcode/:code')
  byBarcode(@TenantId() tenantId: string, @Param('code') code: string) {
    return this.products.getByBarcode(tenantId, code);
  }

  @Get(':id/movements')
  movements(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(productIdParam)) params: { id: string },
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string
  ) {
    return this.products.movements(tenantId, params.id, limit ? Number(limit) : 50, cursor);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param(new ZodValidationPipe(productIdParam)) params: { id: string }) {
    return this.products.get(tenantId, params.id);
  }

  @Post('bulk')
  @RequirePermission('products')
  @UseInterceptors(FileInterceptor('file'))
  bulkImport(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @UploadedFile() file?: { buffer: Buffer }
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    return this.products.bulkImportCsv(tenantId, file.buffer, this.recordedBy(principal));
  }

  @Post()
  @RequirePermission('products')
  @EnforceLimit('products')
  @UseInterceptors(FileInterceptor('image'))
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(createProductSchema)) body: unknown,
    @UploadedFile() image?: { buffer: Buffer; originalname?: string }
  ) {
    return this.products.create(tenantId, body as never, this.recordedBy(principal), image);
  }

  @Put(':id')
  @RequirePermission('products')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(productIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(updateProductSchema)) body: unknown
  ) {
    return this.products.update(tenantId, params.id, body as never, this.recordedBy(principal));
  }

  @Delete(':id')
  @RequirePermission('products')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(productIdParam)) params: { id: string }
  ) {
    return this.products.remove(tenantId, params.id, principal.userId);
  }

  @Put(':id/restore')
  @RequirePermission('products')
  restore(@TenantId() tenantId: string, @Param(new ZodValidationPipe(productIdParam)) params: { id: string }) {
    return this.products.restore(tenantId, params.id);
  }

  @Post(':id/restock')
  @RequirePermission('products')
  restock(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(productIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(restockSchema)) body: unknown
  ) {
    return this.products.restock(tenantId, params.id, body as never, this.recordedBy(principal));
  }

  @Post(':id/adjust')
  @RequirePermission('products')
  adjust(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(productIdParam)) params: { id: string },
    @Body(new ZodValidationPipe(adjustStockSchema)) body: unknown
  ) {
    return this.products.adjust(tenantId, params.id, body as never, this.recordedBy(principal));
  }
}
