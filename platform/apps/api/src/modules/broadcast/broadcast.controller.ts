import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { broadcastContactSchema, broadcastImportSchema, broadcastSendSchema } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { EnforceLimit, RequirePlanFeature } from '../../decorators/plan.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { BroadcastService } from './broadcast.service';

@ApiTags('broadcast')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('broadcast')
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'broadcast', scope: 'tenant' })
@Controller('broadcast')
export class BroadcastController {
  constructor(private readonly broadcast: BroadcastService) {}

  @Get('sent')
  sent(@TenantId() tenantId: string) {
    return this.broadcast.sent(tenantId);
  }

  @Get('contacts/count')
  contactsCount(@TenantId() tenantId: string) {
    return this.broadcast.contactsCount(tenantId);
  }

  @Get('contacts')
  contacts(@TenantId() tenantId: string) {
    return this.broadcast.contacts(tenantId);
  }

  @HttpCode(201)
  @Post('contacts')
  addContact(@TenantId() tenantId: string, @Body(new ZodValidationPipe(broadcastContactSchema)) body: unknown) {
    return this.broadcast.addContact(tenantId, body as never);
  }

  @Post('import-emails')
  importEmails(@TenantId() tenantId: string, @Body(new ZodValidationPipe(broadcastImportSchema)) body: unknown) {
    return this.broadcast.importEmails(tenantId, body as never);
  }

  @Post('send')
  @RequirePlanFeature('broadcast')
  @EnforceLimit('broadcastsPerMonth')
  send(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(broadcastSendSchema)) body: unknown
  ) {
    return this.broadcast.send(tenantId, body as never, principal.name || principal.userId);
  }
}
