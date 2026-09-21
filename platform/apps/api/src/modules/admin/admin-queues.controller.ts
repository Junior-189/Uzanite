import { Controller, ForbiddenException, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../decorators/principal.decorator';
import { RateLimit } from '../../decorators/rate-limit.decorator';
import { AdminMfaGuard } from '../../guards/admin-mfa.guard';
import { Principal } from '../../context/tenant-context';
import { QueueService } from '../../queue/queue.service';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService
  ) {}

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

  @Post('dead-letters/:id/replay')
  async replay(@CurrentUser() principal: Principal, @Param('id') id: string) {
    assertPlatformAdmin(principal);
    const job = await this.queue.getDeadLetter(id);
    if (!job) throw new NotFoundException('Dead letter not found');
    const eventId = job.data.eventId as string | undefined;
    if (eventId) {
      await this.prisma.db.outboxEvent.updateMany({
        where: { id: eventId },
        data: { status: 'pending', attempts: 0, lockedAt: null, availableAt: new Date() },
      });
    }
    await this.queue.removeDeadLetter(id);
    return { success: true, message: 'Dead letter requeued for delivery' };
  }
}
