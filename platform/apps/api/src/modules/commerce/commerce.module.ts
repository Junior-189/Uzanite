import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { BillingModule } from '../billing/billing.module';
import { LedgerModule } from '../finance/ledger.module';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';

@Module({
  imports: [CatalogModule, BillingModule, LedgerModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class CommerceModule {}
