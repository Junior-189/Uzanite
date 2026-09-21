import { Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { listNotificationsQuery, notificationIdParam } from '@uzanite/contracts';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { RequirePermission } from '../../decorators/permissions.decorator';
import { RequirePlanFeature } from '../../decorators/plan.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@RequireTenant()
@RequirePlanFeature('notifications')
@RequirePermission('notifications')
@RateLimit({ limit: 240, windowSeconds: 60, keyPrefix: 'notifications', scope: 'tenant' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('unread-count')
  async unreadCount(@TenantId() tenantId: string) {
    return { success: true, count: await this.notifications.unreadCount(tenantId) };
  }

  @Get()
  list(@TenantId() tenantId: string, @Query(new ZodValidationPipe(listNotificationsQuery)) query: unknown) {
    return this.notifications.list(tenantId, query as never);
  }

  @Put('read-all')
  markAllRead(@TenantId() tenantId: string) {
    return this.notifications.markAllRead(tenantId);
  }

  @Delete()
  removeAll(@TenantId() tenantId: string, @CurrentUser() principal: Principal) {
    return this.notifications.removeAll(tenantId, principal.userId);
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param(new ZodValidationPipe(notificationIdParam)) params: { id: string }) {
    return this.notifications.get(tenantId, params.id);
  }

  @Put(':id/read')
  markRead(@TenantId() tenantId: string, @Param(new ZodValidationPipe(notificationIdParam)) params: { id: string }) {
    return this.notifications.markRead(tenantId, params.id);
  }

  @Put(':id/restore')
  restore(@TenantId() tenantId: string, @Param(new ZodValidationPipe(notificationIdParam)) params: { id: string }) {
    return this.notifications.restore(tenantId, params.id);
  }

  @Delete(':id')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @Param(new ZodValidationPipe(notificationIdParam)) params: { id: string },
    @Query('permanent') permanent?: string
  ) {
    return this.notifications.remove(tenantId, params.id, principal.userId, permanent === 'true');
  }
}
