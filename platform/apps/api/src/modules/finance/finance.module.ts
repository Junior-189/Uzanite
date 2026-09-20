import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { LedgerModule } from './ledger.module';
import { PaymentsService } from './payments.service';
import { PaymentAdaptersService } from './payments/payment-adapters.service';
import { PaymentsController } from './payments.controller';
import { OrderPaymentsController } from './order-payments.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { LedgerController } from './ledger.controller';

@Module({
  imports: [CommerceModule, LedgerModule],
  controllers: [PaymentsController, OrderPaymentsController, PaymentsWebhookController, LedgerController],
  providers: [PaymentsService, PaymentAdaptersService],
  exports: [PaymentsService, LedgerModule],
})
export class FinanceModule {}
