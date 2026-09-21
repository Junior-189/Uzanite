import { Module } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { IdentityModule } from '../identity/identity.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [IdentityModule, BillingModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
