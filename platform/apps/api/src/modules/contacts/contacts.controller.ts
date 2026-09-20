import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  contactEmailSchema,
  contactPhoneParam,
  createContactSchema,
  listContactsQuery,
  updateContactSchema,
} from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { ContactsService } from './contacts.service';

@ApiTags('contacts')
@ApiBearerAuth()
@RequireTenant()
@RequirePermission('contacts')
@RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: 'contacts' })
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listContactsQuery)) query: unknown) {
    return this.contacts.list(tenantId, query as never);
  }

  @Post()
  add(@TenantId() tenantId: string, @Body(new ZodValidationPipe(createContactSchema)) body: unknown) {
    return this.contacts.add(tenantId, body as never);
  }

  @Put(':phone')
  update(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(contactPhoneParam)) params: { phone: string },
    @Body(new ZodValidationPipe(updateContactSchema)) body: unknown
  ) {
    return this.contacts.update(tenantId, params.phone, body as never);
  }

  @Put(':phone/restore')
  restore(@TenantId() tenantId: string, @Param(new ZodValidationPipe(contactPhoneParam)) params: { phone: string }) {
    return this.contacts.restore(tenantId, params.phone);
  }

  @Delete(':phone')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(contactPhoneParam)) params: { phone: string },
    @Query('permanent') permanent?: string
  ) {
    return this.contacts.remove(tenantId, params.phone, principal.userId, permanent === 'true');
  }

  @Get(':phone/messages')
  messages(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(contactPhoneParam)) params: { phone: string },
    @Query('limit') limit?: string
  ) {
    return this.contacts.messages(tenantId, params.phone, Number(limit) || 50);
  }

  @Post(':phone/email')
  sendEmail(
    @TenantId() tenantId: string,
    @Param(new ZodValidationPipe(contactPhoneParam)) params: { phone: string },
    @Body(new ZodValidationPipe(contactEmailSchema)) body: unknown
  ) {
    return this.contacts.sendEmail(tenantId, params.phone, body as never);
  }
}
