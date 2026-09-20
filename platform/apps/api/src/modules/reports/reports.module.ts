import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsPdfService } from './reports-pdf.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsPdfService],
  exports: [ReportsService],
})
export class ReportsModule {}
