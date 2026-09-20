import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { upsertPaymentMethodSchema, updateTenantSchema } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@RequireTenant()
@Controller('tenants/me')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  getProfile(@TenantId() tenantId: string) {
    return this.tenants.getProfile(tenantId);
  }

  @Put()
  update(@TenantId() tenantId: string, @Body(new ZodValidationPipe(updateTenantSchema)) body: unknown) {
    return this.tenants.update(tenantId, body as never);
  }

  @Get('payment-methods')
  listPaymentMethods(@TenantId() tenantId: string) {
    return this.tenants.listPaymentMethods(tenantId);
  }

  @Post('payment-methods')
  upsertPaymentMethod(
    @TenantId() tenantId: string,
    @Body(new ZodValidationPipe(upsertPaymentMethodSchema)) body: unknown
  ) {
    return this.tenants.upsertPaymentMethod(tenantId, body as never);
  }
}
