import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { chatPhoneParam, chatSendSchema } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { WhatsAppService } from './whatsapp.service';

// Legacy `/chat` shape (single-contact history + send) over the messaging module.
@ApiTags('chat')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('whatsapp')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'chat', scope: 'tenant' })
@Controller('chat')
export class ChatController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get(':phone')
  async history(@TenantId() tenantId: string, @Param(new ZodValidationPipe(chatPhoneParam)) params: { phone: string }) {
    const res = await this.whatsapp.listMessages(tenantId, { contactPhone: params.phone, limit: 100 } as never);
    return { success: true, messages: res.messages };
  }

  @Post('send')
  async send(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(chatSendSchema)) body: { phone: string; message: string }
  ) {
    const res = await this.whatsapp.enqueueText(tenantId, { to: body.phone, text: body.message }, principal.name || principal.userId);
    return { success: true, message: (res as { message?: unknown }).message };
  }
}
