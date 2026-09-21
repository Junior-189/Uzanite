import { Module } from '@nestjs/common';
import { BroadcastService } from './broadcast.service';
import { BroadcastController } from './broadcast.controller';
import { MessagingModule } from '../messaging/messaging.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [MessagingModule, BillingModule],
  controllers: [BroadcastController],
  providers: [BroadcastService],
  exports: [BroadcastService],
})
export class BroadcastModule {}
