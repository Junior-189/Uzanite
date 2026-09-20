import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DashboardQuery } from '@uzanite/contracts';
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
    } else if (period === 'yearly') {
      start.setUTCMonth(0, 1);
    }
    return start;
  }

  async stats(tenantId: string, query: DashboardQuery): Promise<{ success: true; stats: DashboardStats }> {
    const where: Prisma.OrderWhereInput = { tenantId, deletedAt: null };
    if (query.period && query.period !== 'all') {
      where.createdAt = { gte: this.periodStart(query.period) };
    }

    const [orders, totalProducts] = await Promise.all([
      this.prisma.db.order.findMany({
        where,
        select: { status: true, total: true, source: true, paymentMethod: true },
      }),
      this.prisma.db.product.count({ where: { tenantId, deletedAt: null, active: true } }),
    ]);

    const countStatus = (status: string) => orders.filter((o) => o.status === status).length;
    const realized = orders.filter((o) => o.status === 'PAID' || o.status === 'DELIVERED');
    const revenue = realized.reduce((sum, o) => sum + Number(o.total), 0);
    const cashOrders = realized.filter((o) => o.source === 'cash' || o.paymentMethod === 'Cash').length;

    return {
      success: true,
      stats: {
        totalOrders: orders.length,
        pendingOrders: countStatus('PENDING'),
        approvedOrders: countStatus('APPROVED'),
        pendingPaymentOrders: countStatus('PENDING_PAYMENT'),
        paidOrders: realized.length,
        rejectedOrders: countStatus('REJECTED'),
        deliveredOrders: countStatus('DELIVERED'),
        revenue,
        cashOrders,
        onlineOrders: realized.length - cashOrders,
        totalProducts,
      },
    };
  }
}
