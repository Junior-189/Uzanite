import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  listConversationsQuery,
  listMessagesQuery,
  messageIdParam,
  sendMediaMessageSchema,
  sendTemplateMessageSchema,
  sendTextMessageSchema,
  templateIdParam,
  upsertWhatsAppAccountSchema,
  upsertWhatsAppTemplateSchema,
} from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { NoRequestTransaction } from '../../decorators/no-request-transaction.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { WhatsAppService } from './whatsapp.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'whatsapp', scope: 'tenant' })
@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  // ── Legacy-shaped account lifecycle adapters (client WhatsApp page) ─────────

  @Get('status')
  @RequirePermission('whatsapp')
  async status(@TenantId() tenantId: string) {
    const { account } = await this.whatsapp.getAccount(tenantId);
    const health = await this.whatsapp.health(tenantId);
    return {
      success: true,
      transport: 'meta',
      connected: health.configured && account?.status === 'connected',
      status: health.status,
      phoneNumberId: account?.phoneNumberId ?? null,
      displayPhoneNumber: health.displayPhoneNumber,
      botPaused: (account as { botPaused?: boolean } | null)?.botPaused ?? false,
    };
  }

  @Get('meta/credentials')
  @RequirePermission('whatsapp')
  async metaCredentials(@TenantId() tenantId: string) {
    const { account } = await this.whatsapp.getAccount(tenantId);
    return {
      success: true,
      account: account ? { ...account, hasToken: !!(account as { hasAccessToken?: boolean }).hasAccessToken } : null,
    };
  }

  @Post('meta/credentials')
  @RequirePermission('whatsapp')
  saveMetaCredentials(@TenantId() tenantId: string, @Body(new ZodValidationPipe(upsertWhatsAppAccountSchema)) body: unknown) {
    return this.whatsapp.upsertAccount(tenantId, body as never);
  }

  @Post('disconnect')
  @RequirePermission('whatsapp')
  disconnect(@TenantId() tenantId: string) {
    return this.whatsapp.deleteAccount(tenantId);
  }

  @Post('pause')
  @RequirePermission('whatsapp')
  pause(@TenantId() tenantId: string) {
    return this.whatsapp.setBotPaused(tenantId, true);
  }

  @Post('resume')
  @RequirePermission('whatsapp')
  resume(@TenantId() tenantId: string) {
    return this.whatsapp.setBotPaused(tenantId, false);
  }

  // The Meta Cloud API has no QR pairing; the client only calls these for the
  // (removed) Baileys transport.
  @Post('connect')
  @RequirePermission('whatsapp')
  connect() {
    throw new BadRequestException('QR pairing is not supported on the Meta Cloud API transport. Configure Meta credentials instead.');
  }

  @Get('qr')
  @RequirePermission('whatsapp')
  qr() {
    throw new BadRequestException('QR pairing is not supported on the Meta Cloud API transport. Configure Meta credentials instead.');
  }

  @Get('account')
  @RequirePermission('whatsapp')
  getAccount(@TenantId() tenantId: string) {
    return this.whatsapp.getAccount(tenantId);
  }

  @Put('account')
  @RequirePermission('whatsapp')
  upsertAccount(@TenantId() tenantId: string, @Body(new ZodValidationPipe(upsertWhatsAppAccountSchema)) body: unknown) {
    return this.whatsapp.upsertAccount(tenantId, body as never);
  }

  @Delete('account')
  @RequirePermission('whatsapp')
  deleteAccount(@TenantId() tenantId: string) {
    return this.whatsapp.deleteAccount(tenantId);
  }

  @Get('health')
  @RequirePermission('whatsapp')
  health(@TenantId() tenantId: string) {
    return this.whatsapp.health(tenantId);
  }

  // ── Templates ────────────────────────────────────────────────────────────────
  @Get('templates')
  @RequirePermission('whatsapp')
  listTemplates(@TenantId() tenantId: string) {
    return this.whatsapp.listTemplates(tenantId);
  }

  @Post('templates')
  @RequirePermission('whatsapp')
  upsertTemplate(@TenantId() tenantId: string, @Body(new ZodValidationPipe(upsertWhatsAppTemplateSchema)) body: unknown) {
    return this.whatsapp.upsertTemplate(tenantId, body as never);
  }

  @Delete('templates/:id')
  @RequirePermission('whatsapp')
  removeTemplate(@TenantId() tenantId: string, @Param(new ZodValidationPipe(templateIdParam)) params: { id: string }) {
    return this.whatsapp.removeTemplate(tenantId, params.id);
  }

  // ── Messages / conversations ─────────────────────────────────────────────────
  @Get('conversations')
  @RequirePermission('whatsapp')
  conversations(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listConversationsQuery)) query: unknown) {
    return this.whatsapp.listConversations(tenantId, query as never);
  }

  @Get('messages')
  @RequirePermission('whatsapp')
  listMessages(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listMessagesQuery)) query: unknown) {
    return this.whatsapp.listMessages(tenantId, query as never);
  }

  @Post('messages/text')
  @RequirePermission('whatsapp')
  sendText(@TenantId() tenantId: string, @Body(new ZodValidationPipe(sendTextMessageSchema)) body: unknown) {
    return this.whatsapp.enqueueText(tenantId, body as never, 'api');
  }

  @Post('messages/template')
  @RequirePermission('whatsapp')
  sendTemplate(@TenantId() tenantId: string, @Body(new ZodValidationPipe(sendTemplateMessageSchema)) body: unknown) {
    return this.whatsapp.enqueueTemplate(tenantId, body as never, 'api');
  }

  @Post('messages/media')
  @RequirePermission('whatsapp')
  sendMedia(@TenantId() tenantId: string, @Body(new ZodValidationPipe(sendMediaMessageSchema)) body: unknown) {
    return this.whatsapp.enqueueMedia(tenantId, body as never, 'api');
  }

  @Get('messages/:id')
  @RequirePermission('whatsapp')
  getMessage(@TenantId() tenantId: string, @Param(new ZodValidationPipe(messageIdParam)) params: { id: string }) {
    return this.whatsapp.getMessage(tenantId, params.id);
  }

  @Post('messages/:id/read')
  @RequirePermission('whatsapp')
  @NoRequestTransaction()
  markRead(@TenantId() tenantId: string, @Param(new ZodValidationPipe(messageIdParam)) params: { id: string }) {
    return this.whatsapp.markRead(tenantId, params.id);
  }
}
