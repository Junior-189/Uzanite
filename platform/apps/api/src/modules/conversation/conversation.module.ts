import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CommerceModule } from '../commerce/commerce.module';
import { FinanceModule } from '../finance/finance.module';
import { ConversationService } from './conversation.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { ConversationController } from './conversation.controller';

@Module({
  // Conversation flows use the real Catalog/Commerce/Finance domains (no rule
  // duplication) and the messaging transport for replies.
  imports: [MessagingModule, CatalogModule, CommerceModule, FinanceModule],
  controllers: [WhatsAppWebhookController, ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
