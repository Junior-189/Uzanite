import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { InvitationsController } from './invitations.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  // BillingModule: membership writes enforce the plan's `staff` seat limit.
  imports: [BillingModule],
  controllers: [TenantsController, MembershipsController, InvitationsController],
  providers: [TenantsService, MembershipsService],
  exports: [TenantsService, MembershipsService],
})
export class TenancyModule {}
