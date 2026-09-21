import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { QueueService } from '../../queue/queue.service';

function assertPlatformAdmin(principal: Principal): void {
  if (!principal?.platformRole) throw new ForbiddenException('Platform admin only');
}

// Operator queue observability (legacy `/admin/queues`).
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminMfaGuard)
@RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: 'admin:queues', scope: 'user' })
@Controller('admin/queues')
export class AdminQueuesController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  async stats(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    const { redis, queues } = await this.queue.stats();
    return { success: true, redis, queues };
  }

  @Get('dead-letters')
  async deadLetters(@CurrentUser() principal: Principal) {
    assertPlatformAdmin(principal);
    const items = await this.queue.deadLetters(50);
    return { success: true, count: items.length, items };
  }
}
