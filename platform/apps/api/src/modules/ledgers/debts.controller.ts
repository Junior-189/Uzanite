import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { debtCreateSchema, debtPaySchema, debtUpdateSchema, idParam, listDebtsQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { DebtsService } from './debts.service';

@ApiTags('debts')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('debts')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'debts', scope: 'tenant' })
@Controller('debts')
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listDebtsQuery)) query: unknown) {
    return this.debts.list(tenantId, query as never);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(debtCreateSchema)) body: unknown
  ) {
    return this.debts.create(tenantId, body as never, principal);
  }

  // Declared before `:id` sub-paths so the literal wins.
  @Post('reminder-all')
  reminderAll(@TenantId() tenantId: string) {
    return this.debts.reminderAll(tenantId);
  }

  @Put(':id')
  update(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(idParam)) params: { id: string },
    @Body(new ZodValidationPipe(debtUpdateSchema)) body: unknown
  ) {
    return this.debts.update(tenantId, params.id, body as never);
  }

  @Post(':id/pay')
  pay(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(idParam)) params: { id: string },
    @Body(new ZodValidationPipe(debtPaySchema)) body: unknown
  ) {
    return this.debts.pay(tenantId, params.id, body as never);
  }

  @Post(':id/reminder')
  reminder(@TenantId() tenantId: string, @Param(new ZodValidationPipe(idParam)) params: { id: string }) {
    return this.debts.reminder(tenantId, params.id);
  }

  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(idParam)) params: { id: string }
  ) {
    return this.debts.remove(tenantId, params.id, principal.userId);
  }
}
