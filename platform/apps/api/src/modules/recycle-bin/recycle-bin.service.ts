import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService } from '../commerce/orders.service';
import { ProductsService } from '../catalog/products.service';
import { NotificationsService } from '../notifications/notifications.service';

export type RecycleBinType = 'orders' | 'products' | 'notifications';

const LIST_LIMIT = 200;

/**
 * Aggregated recycle bin for the platform-owned soft-delete entities.
 *
 * Restores delegate to the owning service so side effects are correct (an order
 * restore re-applies its stock movement). Permanent deletes are guarded:
 * orders with financial records and products with order/movement history are
 * refused, so the recycle bin can never destroy an audit trail.
 */
@Injectable()
export class RecycleBinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly products: ProductsService,
    private readonly notifications: NotificationsService
  ) {}

  async list(tenantId: string) {
    const [products, orders, notifications] = await Promise.all([
      this.prisma.db.product.findMany({ where: { tenantId, deletedAt: { not: null } }, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT }),
      this.prisma.db.order.findMany({ where: { tenantId, deletedAt: { not: null } }, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT }),
      this.prisma.db.notification.findMany({ where: { tenantId, deletedAt: { not: null } }, orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT }),
    ]);
    return { success: true, data: { products, orders, notifications } };
  }

  async restore(tenantId: string, type: RecycleBinType, id: string, actor: string) {
    if (type === 'orders') return this.orders.restore(tenantId, id, actor);
    if (type === 'products') return this.products.restore(tenantId, id);
    return this.notifications.restore(tenantId, id);
  }

  async removePermanent(tenantId: string, type: RecycleBinType, id: string, actor: string) {
    if (type === 'orders') return this.removeOrder(tenantId, id);
    if (type === 'products') return this.removeProduct(tenantId, id);
    return this.notifications.remove(tenantId, id, actor, true);
  }

  private async removeOrder(tenantId: string, id: string) {
    const order = await this.prisma.db.order.findFirst({ where: { id, tenantId, deletedAt: { not: null } } });
    if (!order) throw new NotFoundException('Order not found in recycle bin');

    const [payments, refunds, receipts] = await Promise.all([
      this.prisma.db.payment.count({ where: { tenantId, orderId: id } }),
      this.prisma.db.refund.count({ where: { tenantId, orderId: id } }),
      this.prisma.db.receipt.count({ where: { tenantId, orderId: id } }),
    ]);
    if (payments + refunds + receipts > 0) {
      throw new ConflictException('Cannot permanently delete an order with financial records');
    }

    await this.prisma.transaction(async () => {
      await this.prisma.db.orderItem.deleteMany({ where: { tenantId, orderId: id } });
      await this.prisma.db.orderStatusHistory.deleteMany({ where: { tenantId, orderId: id } });
      await this.prisma.db.order.deleteMany({ where: { id, tenantId } });
    });
    return { success: true, message: 'Order permanently deleted' };
  }

  private async removeProduct(tenantId: string, id: string) {
    const product = await this.prisma.db.product.findFirst({ where: { id, tenantId, deletedAt: { not: null } } });
    if (!product) throw new NotFoundException('Product not found in recycle bin');

    const [orderItems, movements] = await Promise.all([
      this.prisma.db.orderItem.count({ where: { tenantId, productId: id } }),
      this.prisma.db.stockMovement.count({ where: { tenantId, productId: id } }),
    ]);
    if (orderItems + movements > 0) {
      throw new ConflictException('Cannot permanently delete a product with order or stock history');
    }

    await this.prisma.db.product.deleteMany({ where: { id, tenantId } });
    return { success: true, message: 'Product permanently deleted' };
  }
}
