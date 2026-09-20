import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createCategorySchema, productIdParam } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'categories', scope: 'tenant' })
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.categories.list(tenantId);
  }

  @Post()
  @RequirePermission('products')
  create(@TenantId() tenantId: string, @Body(new ZodValidationPipe(createCategorySchema)) body: { name: string }) {
    return this.categories.create(tenantId, body.name);
  }

  @Delete(':id')
  @RequirePermission('products')
  remove(@TenantId() tenantId: string, @Param(new ZodValidationPipe(productIdParam)) params: { id: string }) {
    return this.categories.remove(tenantId, params.id);
  }
}
