import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListNotificationsQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../pagination/pagination';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = { tenantId };
    if (query.includeDeleted !== 'true') where.deletedAt = null;
    if (query.read === 'true') where.read = true;
    if (query.read === 'false') where.read = false;
    if (query.type) where.type = query.type;

    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.notification.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const unreadCount = await this.unreadCount(tenantId);
    return { success: true, count: page.items.length, notifications: page.items, unreadCount, nextCursor: page.nextCursor };
  }

  async unreadCount(tenantId: string): Promise<number> {
    return this.prisma.db.notification.count({ where: { tenantId, read: false, deletedAt: null } });
  }

  async get(tenantId: string, id: string) {
    const notification = await this.prisma.db.notification.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!notification) throw new NotFoundException('Notification not found');
    return { success: true, notification };
  }

  async markRead(tenantId: string, id: string) {
    const res = await this.prisma.db.notification.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { read: true, readAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Notification not found');
    return this.get(tenantId, id);
  }

  async markAllRead(tenantId: string) {
    await this.prisma.db.notification.updateMany({
      where: { tenantId, read: false, deletedAt: null },
      data: { read: true, readAt: new Date() },
    });
    return { success: true };
  }

  async remove(tenantId: string, id: string, userId: string, permanent = false) {
    if (permanent) {
      const res = await this.prisma.db.notification.deleteMany({ where: { id, tenantId } });
      if (res.count === 0) throw new NotFoundException('Notification not found');
      return { success: true, message: 'Notification permanently deleted' };
    }
    const res = await this.prisma.db.notification.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    if (res.count === 0) throw new NotFoundException('Notification not found');
    return { success: true, message: 'Notification moved to recycle bin' };
  }

  async removeAll(tenantId: string, userId: string) {
    await this.prisma.db.notification.updateMany({
      where: { tenantId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    return { success: true, message: 'All notifications moved to recycle bin' };
  }

  async restore(tenantId: string, id: string) {
    const res = await this.prisma.db.notification.updateMany({
      where: { id, tenantId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null },
    });
    if (res.count === 0) throw new NotFoundException('Notification not found in recycle bin');
    return { success: true, message: 'Notification restored' };
  }
}
