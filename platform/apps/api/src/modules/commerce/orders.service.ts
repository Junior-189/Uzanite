import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderSource, OrderStatus, Prisma } from '@prisma/client';
import { CreateOrderInput, isAllTimePeriod, ListOrdersQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../catalog/stock.service';
import { OutboxService } from '../../outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { LedgerService } from '../finance/ledger.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { OrderIntakeService, ResolvedItem } from './order-intake.service';
import { blindIndex, decryptPii, encryptPii } from '../../security/pii';

// ── State machine ────────────────────────────────────────────────────────────
// PENDING → APPROVED → PENDING_PAYMENT → PAID → DELIVERED
//          ↘ REJECTED (restores stock)
// Mirrors the legacy Express lifecycle. REJECTED and DELIVERED are terminal.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PENDING_PAYMENT', 'PAID', 'REJECTED'],
  PENDING_PAYMENT: ['PAID', 'REJECTED'],
  PAID: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  statusHistory: { orderBy: { changedAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  // Intake (numbering + item pricing) is a separate concern.
  private readonly intake: OrderIntakeService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService,
    private readonly ledger: LedgerService
  ) {
    this.intake = new OrderIntakeService(this.prisma);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  private async getOrThrow(tenantId: string, id: string, includeDeleted = false) {
    const order = await this.prisma.db.order.findFirst({
      where: { id, tenantId, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private serialize<T extends { id: string }>(order: T): T & { _id: string } {
    // `_id` alias preserves compatibility with Express clients that key on it;
    // encrypted PII fields are decrypted for the response.
    const row = order as T & { customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null; deliveryLocation?: string | null; deliveryPhone?: string | null };
    return {
      ...order,
      _id: order.id,
      ...(row.customerName !== undefined ? { customerName: decryptPii(row.customerName) } : {}),
      ...(row.customerPhone !== undefined ? { customerPhone: decryptPii(row.customerPhone) } : {}),
      ...(row.customerEmail !== undefined ? { customerEmail: decryptPii(row.customerEmail) } : {}),
      ...(row.deliveryLocation !== undefined ? { deliveryLocation: decryptPii(row.deliveryLocation) } : {}),
      ...(row.deliveryPhone !== undefined ? { deliveryPhone: decryptPii(row.deliveryPhone) } : {}),
    };
  }

  async get(tenantId: string, id: string) {
    const order = await this.getOrThrow(tenantId, id);
    return { success: true, order: this.serialize(order) };
  }

  async getByNumber(tenantId: string, orderNumber: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { tenantId, orderNumber, deletedAt: null },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found');
    return { success: true, order: this.serialize(order) };
  }

  async history(tenantId: string, id: string) {
    await this.getOrThrow(tenantId, id);
    const history = await this.prisma.db.orderStatusHistory.findMany({
      where: { tenantId, orderId: id },
      orderBy: { changedAt: 'asc' },
    });
    return { success: true, count: history.length, history };
  }

  async list(tenantId: string, query: ListOrdersQuery) {
    const where: Prisma.OrderWhereInput = { tenantId };
    if (query.includeDeleted !== 'true') where.deletedAt = null;
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.customerPhone) where.customerPhoneIdx = blindIndex(query.customerPhone);
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(query.to);
    } else if (!isAllTimePeriod(query.period)) {
      where.createdAt = { gte: this.periodStart(query.period as string) };
    }

    const page = await paginate<{ id: string }>({
      findMany: (args) =>
        this.prisma.db.order.findMany({ ...(args as object), include: ORDER_INCLUDE } as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const orders = page.items.map((o) => this.serialize(o as { id: string }));
    return { success: true, count: orders.length, orders, nextCursor: page.nextCursor };
  }

  private periodStart(period: string): Date {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'weekly') {
      const dow = start.getUTCDay();
      const diff = dow === 0 ? 6 : dow - 1; // Monday start
      start.setUTCDate(start.getUTCDate() - diff);
    } else if (period === 'monthly') {
      start.setUTCDate(1);
    } else if (period === 'yearly' || period === 'annually') {
      start.setUTCMonth(0, 1);
    }
    return start;
  }

  // ── Stock integration (single path: StockService.applyChange) ────────────────
  /** Restores stock when an order is refunded (idempotent per item+reason). */
  async restoreStockForRefund(tenantId: string, orderId: string, actor: string): Promise<void> {
    const order = await this.prisma.db.order.findFirst({ where: { id: orderId, tenantId }, include: { items: true } });
    if (!order) return;
    await this.changeStock(tenantId, orderId, order.items, 'refund', 'restore', actor);
  }

  private async changeStock(
    tenantId: string,
    orderId: string,
    items: Array<{ id: string; productId: string | null; quantity: number }>,
    reason: 'order_created' | 'order_rejected' | 'order_deleted' | 'order_restored' | 'refund',
    direction: 'deduct' | 'restore',
    recordedBy: string
  ): Promise<void> {
    for (const item of items) {
      if (!item.productId) continue;
      await this.stock.applyChange({
        tenantId,
        productId: item.productId,
        delta: direction === 'deduct' ? -item.quantity : item.quantity,
        reason,
        refType: 'order',
        refId: orderId,
        // Item-scoped dedupe key: unique even when a product appears on several lines.
        dedupeKey: `order:${orderId}:${item.id}:${reason}`,
        recordedBy,
      });
    }
  }

  // ── Creation ─────────────────────────────────────────────────────────────────
  private async findByClientRef(tenantId: string, clientRef: string) {
    return this.prisma.db.order.findFirst({ where: { tenantId, clientRef, deletedAt: null }, include: ORDER_INCLUDE });
  }

  async create(tenantId: string, input: CreateOrderInput, actor: string, cash = false) {
    // Service-level entitlement check: the WhatsApp flow reaches this directly.
    await this.billing.assertLimit(tenantId, 'ordersPerMonth');
    const clientRef = input.clientRef?.trim() ? input.clientRef.trim() : null;

    // Idempotency: a replayed create with the same clientRef returns the original.
    if (clientRef) {
      const existing = await this.findByClientRef(tenantId, clientRef);
      if (existing) return { success: true, order: this.serialize(existing), idempotent: true };
    }

    const items = await this.intake.resolveItems(tenantId, input.items);
    const calculatedTotal = round2(items.reduce((sum, i) => sum + i.subtotal, 0));
    const floorTotal = round2(items.reduce((sum, i) => sum + i.minPrice * i.quantity, 0));
    const offered = input.offeredTotal !== undefined ? round2(input.offeredTotal) : undefined;
    if (offered !== undefined) {
      if (offered > calculatedTotal) {
        throw new BadRequestException(`Offered total ${offered} cannot exceed the order total ${calculatedTotal}`);
      }
      if (offered < floorTotal) {
        throw new BadRequestException(`Offered total ${offered} is below the minimum allowed ${floorTotal}`);
      }
    }
    const total = offered ?? calculatedTotal;
    const currency = (items[0]?.currency ?? 'TZS').toUpperCase();
    const source: OrderSource = cash ? 'cash' : input.source;

    let orderId: string;
    try {
      orderId = await this.prisma.transaction(async () => {
        const id = newId();
        const orderNumber = await this.intake.nextOrderNumber(tenantId);
        const now = new Date();

        await this.prisma.db.order.create({
          data: {
            id,
            tenantId,
            orderNumber,
            clientRef,
            customerPhone: encryptPii(input.customerPhone) ?? '',
            customerPhoneIdx: input.customerPhone ? blindIndex(input.customerPhone) : null,
            customerName: encryptPii(input.customerName) ?? 'Customer',
            // PII at rest: encrypted; the blind-index rollout covers name/phone.
            customerEmail: encryptPii(input.customerEmail) ?? '',
            deliveryLocation: encryptPii(input.deliveryLocation) ?? '',
            deliveryPhone: encryptPii(input.deliveryPhone) ?? '',
            source,
            recordedBy: actor,
            total: String(total),
            originalTotal: input.offeredTotal !== undefined ? String(calculatedTotal) : null,
            offeredTotal: input.offeredTotal !== undefined ? String(total) : null,
            currency,
            status: cash ? 'PAID' : 'PENDING',
            adminNote: '',
            rejectionReason: '',
            paymentMethod: cash ? 'Cash' : '',
            paymentReference: cash ? 'Walk-in Cash' : '',
            paymentConfirmedAt: cash ? now : null,
            deliveredAt: cash ? now : null,
          },
        });

        await this.prisma.db.orderItem.createMany({
          data: items.map((i) => ({
            id: i.id,
            tenantId,
            orderId: id,
            productId: i.productId,
            legacyProductId: i.legacyProductId,
            productName: i.productName,
            price: String(i.price),
            currency: i.currency,
            quantity: i.quantity,
            subtotal: String(i.subtotal),
          })),
        });

        await this.prisma.db.orderStatusHistory.create({
          data: {
            id: newId(),
            tenantId,
            orderId: id,
            status: cash ? 'PAID' : 'PENDING',
            note: cash ? 'Walk-in cash order created' : 'Order created',
            changedBy: actor,
          },
        });

        // Deduct stock after the order exists so movements can reference its id.
        await this.changeStock(tenantId, id, items, 'order_created', 'deduct', actor);

        await this.outbox.enqueue({
          type: 'order.created',
          tenantId,
          payload: { orderId: id, orderNumber, total, currency, source, itemCount: items.length },
        });
        if (cash) {
          // Cash sales are settled at creation: record the money in the ledger.
          await this.ledger.record({
            tenantId,
            type: 'cash_sale',
            direction: 'credit',
            amount: total,
            currency,
            refType: 'order',
            refId: id,
            dedupeKey: `order:${id}:cash_sale`,
            description: 'Walk-in cash sale',
            meta: { orderNumber, source: 'cash' },
            recordedBy: actor,
          });
          await this.outbox.enqueue({
            type: 'order.paid',
            tenantId,
            payload: { orderId: id, orderNumber, total, currency, method: 'Cash' },
          });
        }

        await this.billing.incrementUsage(tenantId, 'ordersPerMonth', 1, true);
        return id;
      });
    } catch (err) {
      // Concurrent duplicate clientRef: return the winner instead of erroring.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && clientRef) {
        const existing = await this.findByClientRef(tenantId, clientRef);
        if (existing) return { success: true, order: this.serialize(existing), idempotent: true };
      }
      throw err;
    }
    const result = await this.get(tenantId, orderId);
    return { ...result, idempotent: false };
  }

  async createManual(tenantId: string, input: CreateOrderInput, actor: string) {
    return this.create(tenantId, input, actor, true);
  }

  // ── Transitions ──────────────────────────────────────────────────────────────
  private async applyTransition(
    tenantId: string,
    id: string,
    to: OrderStatus,
    opts: { note?: string; changedBy?: string; data?: Prisma.OrderUpdateManyMutationInput }
  ) {
    const order = await this.prisma.db.order.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === to) return order; // idempotent
    if (!TRANSITIONS[order.status].includes(to)) {
      throw new ConflictException(`Cannot move order from ${order.status} to ${to}`);
    }
    const res = await this.prisma.db.order.updateMany({
      where: { id, tenantId, status: order.status, version: order.version },
      data: { status: to, version: { increment: 1 }, ...(opts.data ?? {}) },
    });
    if (res.count === 0) throw new ConflictException('Order was modified by someone else — reload and retry');
    await this.prisma.db.orderStatusHistory.create({
      data: {
        id: newId(),
        tenantId,
        orderId: id,
        status: to,
        note: opts.note ?? '',
        changedBy: opts.changedBy ?? null,
      },
    });
    return this.prisma.db.order.findFirst({ where: { id, tenantId } });
  }

  async approve(tenantId: string, id: string, note: string, actor: string) {
    await this.prisma.transaction(async () => {
      await this.applyTransition(tenantId, id, 'APPROVED', { note, changedBy: actor, data: { adminNote: note } });
      await this.applyTransition(tenantId, id, 'PENDING_PAYMENT', { note: 'Payment requested', changedBy: actor });
      await this.outbox.enqueue({ type: 'order.approved', tenantId, payload: { orderId: id, note } });
      await this.outbox.enqueue({ type: 'order.payment_requested', tenantId, payload: { orderId: id } });
    });
    return this.get(tenantId, id);
  }

  async reject(tenantId: string, id: string, reason: string, actor: string) {
    const order = await this.getOrThrow(tenantId, id);
    if (order.status === 'REJECTED') return this.get(tenantId, id); // idempotent
    if (!TRANSITIONS[order.status].includes('REJECTED')) {
      throw new ConflictException(`Cannot reject an order in status ${order.status}`);
    }
    await this.prisma.transaction(async () => {
      const res = await this.prisma.db.order.updateMany({
        where: { id, tenantId, status: order.status, version: order.version },
        data: { status: 'REJECTED', rejectionReason: reason, version: { increment: 1 } },
      });
      if (res.count === 0) throw new ConflictException('Order was modified by someone else — reload and retry');
      await this.prisma.db.orderStatusHistory.create({
        data: { id: newId(), tenantId, orderId: id, status: 'REJECTED', note: reason, changedBy: actor },
      });
      await this.changeStock(tenantId, id, order.items, 'order_rejected', 'restore', actor);
      await this.outbox.enqueue({ type: 'order.rejected', tenantId, payload: { orderId: id, reason } });
    });
    return this.get(tenantId, id);
  }

  async requestPayment(tenantId: string, id: string, actor: string) {
    await this.prisma.transaction(async () => {
      await this.applyTransition(tenantId, id, 'PENDING_PAYMENT', { note: 'Payment requested', changedBy: actor });
      await this.outbox.enqueue({ type: 'order.payment_requested', tenantId, payload: { orderId: id } });
    });
    return this.get(tenantId, id);
  }

  /**
   * Record a customer-submitted payment proof/reference. Moves an APPROVED order
   * to PENDING_PAYMENT (or just updates the reference if already there). This is
   * the Commerce-owned path used by the WhatsApp flow — no parallel system.
   */
  async markPaymentSubmitted(tenantId: string, id: string, reference: string, actor: string): Promise<void> {
    await this.prisma.transaction(async () => {
      const order = await this.prisma.db.order.findFirst({ where: { id, tenantId, deletedAt: null } });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status === 'PENDING_PAYMENT') {
        await this.prisma.db.order.updateMany({
          where: { id, tenantId },
          data: { paymentReference: reference, version: { increment: 1 } },
        });
      } else if (order.status === 'APPROVED') {
        await this.applyTransition(tenantId, id, 'PENDING_PAYMENT', {
          note: `Payment proof submitted: ${reference}`,
          changedBy: actor,
          data: { paymentReference: reference },
        });
      } else {
        throw new ConflictException(`Cannot submit payment proof for an order in status ${order.status}`);
      }
      await this.outbox.enqueue({ type: 'order.payment_proof_submitted', tenantId, payload: { orderId: id, reference } });
    });
  }

  /**
   * Settle an order to PAID (order-side effect only). Finance owns the Payment
   * and Ledger records; this runs inside the caller's transaction so the
   * payment, ledger entry and order status commit atomically.
   */
  async markPaid(
    tenantId: string,
    id: string,
    opts: { method: string; reference: string; proofPath?: string | null; actor: string }
  ): Promise<void> {
    const order = await this.prisma.db.order.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === 'PAID' || order.status === 'DELIVERED') return; // idempotent
    await this.applyTransition(tenantId, id, 'PAID', {
      note: `Payment confirmed via ${opts.method}`,
      changedBy: opts.actor,
      data: {
        paymentMethod: opts.method,
        paymentReference: opts.reference,
        paymentConfirmedAt: new Date(),
        ...(opts.proofPath !== undefined ? { paymentProofPath: opts.proofPath } : {}),
      },
    });
    await this.outbox.enqueue({
      type: 'order.paid',
      tenantId,
      payload: { orderId: id, method: opts.method, reference: opts.reference },
    });
  }

  async deliver(tenantId: string, id: string, note: string, actor: string) {
    await this.prisma.transaction(async () => {
      await this.applyTransition(tenantId, id, 'DELIVERED', {
        note,
        changedBy: actor,
        data: { deliveryNote: note, deliveredAt: new Date() },
      });
      await this.outbox.enqueue({ type: 'order.delivered', tenantId, payload: { orderId: id, note } });
    });
    return this.get(tenantId, id);
  }

  // ── Delete / restore (soft, stock-aware) ─────────────────────────────────────
  async remove(tenantId: string, id: string, actor: string, permanent = false, userId?: string) {
    const order = await this.getOrThrow(tenantId, id);
    await this.prisma.transaction(async () => {
      // Finance safety: never hard-delete an order that has financial records —
      // that would orphan payments/refunds/receipts. Soft delete (archive) is
      // always allowed.
      if (permanent) {
        const [payments, refunds, receipts] = await Promise.all([
          this.prisma.db.payment.count({ where: { tenantId, orderId: id } }),
          this.prisma.db.refund.count({ where: { tenantId, orderId: id } }),
          this.prisma.db.receipt.count({ where: { tenantId, orderId: id } }),
        ]);
        if (payments + refunds + receipts > 0) {
          throw new ConflictException(
            'Cannot permanently delete an order with payment, refund, or receipt records; move it to the recycle bin instead.'
          );
        }
      }

      // Atomic guard: only the first concurrent delete wins, so stock is restored once.
      const res = await this.prisma.db.order.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: userId ?? null, version: { increment: 1 } },
      });
      if (res.count === 0) throw new NotFoundException('Order not found or already deleted');

      // Reversing the original deduction, unless it was already reversed by a rejection.
      if (order.status !== 'REJECTED') {
        await this.changeStock(tenantId, id, order.items, 'order_deleted', 'restore', actor);
      }

      if (permanent) {
        await this.prisma.db.orderItem.deleteMany({ where: { tenantId, orderId: id } });
        await this.prisma.db.orderStatusHistory.deleteMany({ where: { tenantId, orderId: id } });
        await this.prisma.db.order.deleteMany({ where: { id, tenantId } });
      }
      await this.outbox.enqueue({ type: 'order.deleted', tenantId, payload: { orderId: id, permanent } });
    });
    return { success: true, message: permanent ? 'Order permanently deleted' : 'Order moved to recycle bin' };
  }

  async restore(tenantId: string, id: string, actor: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { id, tenantId, deletedAt: { not: null } },
      include: ORDER_INCLUDE,
    });
    if (!order) throw new NotFoundException('Order not found in recycle bin');

    await this.prisma.transaction(async () => {
      const res = await this.prisma.db.order.updateMany({
        where: { id, tenantId, deletedAt: { not: null } },
        data: { deletedAt: null, deletedBy: null, version: { increment: 1 } },
      });
      if (res.count === 0) throw new NotFoundException('Order not found in recycle bin');

      // Re-apply the stock impact that was reversed on delete (unless rejected).
      if (order.status !== 'REJECTED') {
        await this.changeStock(tenantId, id, order.items, 'order_restored', 'deduct', actor);
      }
      await this.outbox.enqueue({ type: 'order.restored', tenantId, payload: { orderId: id } });
    });
    return { success: true, message: 'Order restored' };
  }
}
