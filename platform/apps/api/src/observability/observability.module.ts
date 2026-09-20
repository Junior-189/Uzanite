import { Global, Module } from '@nestjs/common';
import { ErrorTrackerService } from './error-tracker.service';
import { TracingService } from './tracing.service';
import { OperationalMetricsService } from './operational-metrics.service';

@Global()
@Module({
  providers: [ErrorTrackerService, TracingService, OperationalMetricsService],
  exports: [ErrorTrackerService, TracingService, OperationalMetricsService],
})
export class ObservabilityModule {}
