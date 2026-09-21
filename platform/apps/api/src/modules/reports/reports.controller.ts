import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { reportKeyParam, reportQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';
import { ReportsPdfService } from './reports-pdf.service';

@ApiTags('reports')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('reports')
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'reports', scope: 'tenant' })
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly pdf: ReportsPdfService
  ) {}

  @Get('summary')
  summary(@TenantId() tenantId: string, @Query(new ZodValidationPipe(reportQuery)) query: unknown) {
    return this.reports.summary(tenantId, query as never);
  }

  @Get(':key/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="report.csv"')
  async csv(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(reportKeyParam)) params: { key: 'full' | 'orders' | 'products' | 'expenses' | 'purchases' | 'debts' | 'staff' },
    @Query(new ZodValidationPipe(reportQuery)) query: unknown
  ) {
    const datasets = await this.reports.build(tenantId, params.key, query as never);
    return this.reports.toCsv(datasets);
  }

  @Get(':key')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="report.pdf"')
  async report(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(reportKeyParam)) params: { key: 'full' | 'orders' | 'products' | 'expenses' | 'purchases' | 'debts' | 'staff' },
    @Query(new ZodValidationPipe(reportQuery)) query: { period: string }
  ) {
    const [datasets, businessName] = await Promise.all([
      this.reports.build(tenantId, params.key, query as never),
      this.reports.businessName(tenantId),
    ]);
    return this.pdf.render(businessName, query.period, datasets);
  }
}
