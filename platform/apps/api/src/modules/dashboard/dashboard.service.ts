import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DashboardQuery, isAllTimePeriod } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';

export interface DashboardStats {
  totalOrders: number;
  pendingOrders: number;
  approvedOrders: number;
  pendingPaymentOrders: number;
  paidOrders: number;
  rejectedOrders: number;
  deliveredOrders: number;
  revenue: number;
  cashOrders: number;
  onlineOrders: number;
  totalProducts: number;
}

/**
 * Tenant-scoped dashboard KPIs. Mirrors the legacy `/dashboard/stats` shape the
 * admin client consumes (the same 8 order counters, plus revenue/products).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private periodStart(period: string): Date {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'weekly') {
      const dow = start.getUTCDay();
      const diff = dow === 0 ? 6 : dow - 1;
      start.setUTCDate(start.getUTCDate() - diff);
    } else if (period === 'monthly') {
      start.setUTCDate(1);
    } else if (period === 'yearly' || period === 'annually') {
      start.setUTCMonth(0, 1);
    }
    return start;
  }

  async stats(tenantId: string, query: DashboardQuery): Promise<{ success: true; stats: DashboardStats }> {
    const where: Prisma.OrderWhereInput = { tenantId, deletedAt: null };
    if (!isAllTimePeriod(query.period)) {
      where.createdAt = { gte: this.periodStart(query.period as string) };
    }

    // Aggregate in SQL — loading every order into memory does not scale.
    const realizedStatuses = ['PAID', 'DELIVERED'] as const;
    const realizedWhere = { ...where, status: { in: [...realizedStatuses] } };
    const [statusGroups, revenueAgg, cashOrders, totalProducts] = await Promise.all([
      this.prisma.db.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.db.order.aggregate({ where: realizedWhere, _sum: { total: true }, _count: true }),
      this.prisma.db.order.count({
        where: { ...realizedWhere, OR: [{ source: 'cash' }, { paymentMethod: 'Cash' }] },
      }),
      this.prisma.db.product.count({ where: { tenantId, deletedAt: null, active: true } }),
    ]);

    const counts = new Map(statusGroups.map((g) => [g.status as string, g._count._all]));
    const countStatus = (status: string) => counts.get(status) ?? 0;
    const realizedCount = Number(revenueAgg._count ?? 0);

    return {
      success: true,
      stats: {
        totalOrders: statusGroups.reduce((sum, g) => sum + g._count._all, 0),
        pendingOrders: countStatus('PENDING'),
        approvedOrders: countStatus('APPROVED'),
        pendingPaymentOrders: countStatus('PENDING_PAYMENT'),
        paidOrders: realizedCount,
        rejectedOrders: countStatus('REJECTED'),
        deliveredOrders: countStatus('DELIVERED'),
        revenue: Number(revenueAgg._sum?.total ?? 0),
        cashOrders,
        onlineOrders: realizedCount - cashOrders,
        totalProducts,
      },
    };
  }
}
