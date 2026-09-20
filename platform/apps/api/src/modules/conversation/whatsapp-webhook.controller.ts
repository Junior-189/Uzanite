import {
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { MetaWebhookBody } from '@uzanite/messaging';
import { Public } from '../../decorators/public.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { WhatsAppWebhookService } from '../messaging/whatsapp-webhook.service';
import { ConversationService } from './conversation.service';

/**
 * Meta WhatsApp Cloud webhook. Unauthenticated by JWT but signature-verified.
 * Records inbound/status via the messaging service, then (per tenant rollout
 * mode) runs the conversation flow and enqueues replies through the durable
 * send path. The webhook never calls Meta directly.
 */
@ApiTags('whatsapp')
@RateLimit({ limit: 300, windowSeconds: 60, keyPrefix: 'wh:whatsapp', scope: 'ip' })
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly webhook: WhatsAppWebhookService,
    private readonly conversation: ConversationService
  ) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response
  ): void {
    if (!this.webhook.configured()) return void res.sendStatus(503);
    const result = this.webhook.verifyChallenge(mode, token, challenge);
    if (!result.ok) return void res.sendStatus(403);
    this.logger.log('Meta webhook verified');
    res.status(200).send(result.challenge ?? '');
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request): Promise<{ success: boolean; processed: number; failed: number }> {
    if (!this.webhook.configured()) {
      throw new ServiceUnavailableException('Webhook disabled: Meta credentials not configured');
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body ?? {});
    if (!this.webhook.verifySignature(rawBody, req.headers['x-hub-signature-256'] as string | undefined)) {
      this.logger.warn('Rejected Meta webhook with invalid/missing signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 1) Record inbound messages + statuses (its own transaction).
    const result = await this.webhook.handle((req.body ?? {}) as MetaWebhookBody);

    // 2) Run the conversation flow for each newly recorded inbound message.
    for (const ev of result.inbound) {
      try {
        await this.conversation.processInbound(ev);
      } catch (err) {
        this.logger.error(`Conversation flow failed for ${ev.providerMessageId}: ${(err as Error).message}`);
        await this.conversation.handleFailure(ev);
      }
    }

    // A non-2xx response makes Meta retry; already-processed sub-events are deduped.
    if (result.failed > 0) throw new InternalServerErrorException(`webhook partially failed (${result.failed})`);
    return { success: true, processed: result.processed, failed: result.failed };
  }
}
