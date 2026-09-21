import { Module } from '@nestjs/common';
import { MetaClient } from '@uzanite/messaging';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { WhatsAppController } from './whatsapp.controller';
import { ChatController } from './chat.controller';

// NOTE: the `/whatsapp/webhook` route is owned by ConversationModule so the
// flow can use the Catalog/Commerce/Finance domains without a module cycle.
@Module({
  controllers: [WhatsAppController, ChatController],
  providers: [
    WhatsAppService,
    WhatsAppWebhookService,
    { provide: MetaClient, useFactory: () => new MetaClient() },
  ],
  exports: [WhatsAppService, WhatsAppWebhookService],
})
export class MessagingModule {}
