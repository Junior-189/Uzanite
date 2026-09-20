import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { expenseCreateSchema, idParam, listExpensesQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('expenses')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'expenses', scope: 'tenant' })
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listExpensesQuery)) query: unknown) {
    return this.expenses.list(tenantId, query as never);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(expenseCreateSchema)) body: unknown
  ) {
    return this.expenses.create(tenantId, body as never, principal);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string,     @Param(new ZodValidationPipe(idParam)) params: { id: string }) {
    return this.expenses.remove(tenantId, params.id);
  }
}
