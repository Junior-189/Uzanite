import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { listFlowTracesQuery } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { TenantId } from '../../decorators/principal.decorator';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ConversationService } from './conversation.service';

const cleanupSchema = z.object({ maxAgeHours: z.coerce.number().int().min(1).max(720).optional().default(24) }).strict();

@ApiTags('whatsapp')
@ApiBearerAuth()
@RequireTenant()
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'conversation', scope: 'tenant' })
@Controller('whatsapp')
export class ConversationController {
  constructor(private readonly conversation: ConversationService) {}

  /** Flow-decision traces (all modes) for shadow-mode parity review. */
  @Get('flow-traces')
  @RequirePermission('whatsapp')
  listTraces(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listFlowTracesQuery)) query: unknown) {
    return this.conversation.listTraces(tenantId, query as never);
  }

  /** Reset conversations idle beyond `maxAgeHours` back to the main menu. */
  @Post('conversations/cleanup')
  @RequirePermission('whatsapp')
  async cleanup(@Body(new ZodValidationPipe(cleanupSchema)) body: { maxAgeHours: number }) {
    const reset = await this.conversation.cleanupStale(body.maxAgeHours);
    return { success: true, reset };
  }
}
