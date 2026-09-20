import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmailService } from '../email.service';
import { NotificationWriter } from './notification-writer.service';
import { ReceiptWriter } from './receipt-writer.service';
import { WhatsAppOutboundService } from '../messaging/whatsapp-outbound.service';

export interface OutboxEventRecord {
  id: string;
  tenantId: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** A deferred effect (network I/O) that must run AFTER the DB transaction commits. */
export type SideEffect = () => Promise<void>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => Number(v ?? 0);

/**
 * Routes outbox events to their consumers. Every DB handler is idempotent
 * (dedupe keys / upserts) because the publisher guarantees at-least-once
 * delivery.
 *
 * `dispatch` runs inside the publisher's system transaction and performs only
 * DATABASE writes. Network side effects (email/SMTP) are returned as
 * `SideEffect[]` and executed by the publisher after commit, so the DB
 * transaction is never held open during a remote call.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly notifications: NotificationWriter,
    private readonly receipts: ReceiptWriter,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppOutboundService
  ) {}

  async dispatch(event: OutboxEventRecord, tx: Prisma.TransactionClient): Promise<SideEffect[]> {
    const { type, tenantId, payload } = event;

    if (type === 'email.send') return this.onEmail(payload);
    if (!tenantId) {
      this.logger.debug(`Skipping ${type} without a tenantId`);
      return [];
    }

    switch (type) {
      case 'order.created':
        await this.onOrderCreated(tenantId, payload, tx);
        return [];
      case 'order.approved':
        await this.onOrderApproved(tenantId, payload, tx);
        return [];
      case 'order.paid':
        return this.onOrderPaid(tenantId, payload, tx);
      case 'order.rejected':
        await this.onOrderRejected(tenantId, payload, tx);
        return [];
      case 'order.delivered':
        await this.onOrderDelivered(tenantId, payload, tx);
        return [];
      case 'order.deleted':
        await this.onOrderDeleted(tenantId, payload, tx);
        return [];
      case 'payment.succeeded':
        await this.onPaymentSucceeded(tenantId, payload, tx);
        return [];
      case 'payment.failed':
        await this.onPaymentFailed(tenantId, payload, tx);
        return [];
      case 'payment.refunded':
        await this.onPaymentRefunded(tenantId, payload, tx);
        return [];
      case 'payment.awaiting_order_approval':
        await this.onPaymentAwaitingApproval(tenantId, payload, tx);
        return [];
      case 'product.low_stock':
        await this.onLowStock(tenantId, event, tx);
        return [];
      case 'product.out_of_stock':
        await this.onOutOfStock(tenantId, event, tx);
        return [];
      case 'whatsapp.send':
        await this.onWhatsAppSend(tenantId, payload, tx);
        return [];
      case 'whatsapp.inbound':
        this.onWhatsAppInbound(tenantId, payload);
        return [];
      default:
        this.logger.debug(`No consumer for outbox event type ${type}`);
        return [];
    }
  }

  // ── Email ────────────────────────────────────────────────────────────────────
  // No DB write: the SMTP call is deferred to the publisher (post-commit).
  private onEmail(payload: Record<string, unknown>): SideEffect[] {
    const message = {
      to: str(payload.to),
      subject: str(payload.subject),
      html: str(payload.html),
      text: payload.text ? str(payload.text) : undefined,
    };
    return [() => this.email.send(message)];
  }

  // ── Order handlers ───────────────────────────────────────────────────────────
  private async onOrderCreated(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const orderId = str(payload.orderId);
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_created',
      title: 'New Order',
      message: `Order ${str(payload.orderNumber ?? order?.orderNumber)} created for ${order?.customerName ?? 'a customer'}`,
      data: { orderId },
      priority: 'normal',
      dedupeKey: `order.created:${orderId}`,
    });
  }

  private async onOrderApproved(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const orderId = str(payload.orderId);
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_approved',
      title: 'Order Approved',
      message: `Order ${order?.orderNumber ?? orderId} approved${payload.note ? `: ${str(payload.note)}` : ''}`,
      data: { orderId },
      dedupeKey: `order.approved:${orderId}`,
    });
  }

  private async onOrderPaid(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<SideEffect[]> {
    const orderId = str(payload.orderId);
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_paid',
      title: 'Order Paid',
      message: `Order ${order?.orderNumber ?? orderId} paid via ${str(payload.method ?? order?.paymentMethod ?? 'payment')}`,
      data: { orderId },
      priority: 'high',
      dedupeKey: `order.paid:${orderId}`,
    });

    const receipt = await this.receipts.createForOrder(tx, orderId);
    if (!order?.customerEmail) return [];

    // Receipt email is best-effort: a failure must not fail/retry the event.
    const email = this.email;
    const logger = this.logger;
    const html = this.receiptEmailHtml(order, receipt?.id ?? null);
    return [
      async () => {
        try {
          await email.send({
            to: order.customerEmail,
            subject: `Receipt for order ${order.orderNumber}`,
            html,
            text: `Thank you. Order ${order.orderNumber} total ${order.currency} ${num(order.total).toLocaleString()}.`,
          });
        } catch (err) {
          logger.error(`Receipt email failed for order ${orderId}: ${(err as Error).message}`);
        }
      },
    ];
  }

  private async onOrderRejected(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const orderId = str(payload.orderId);
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_rejected',
      title: 'Order Rejected',
      message: `Order ${order?.orderNumber ?? orderId} rejected${payload.reason ? `: ${str(payload.reason)}` : ''}`,
      data: { orderId },
      priority: 'high',
      dedupeKey: `order.rejected:${orderId}`,
    });
  }

  private async onOrderDelivered(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const orderId = str(payload.orderId);
    const order = orderId ? await tx.order.findUnique({ where: { id: orderId } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_delivered',
      title: 'Order Delivered',
      message: `Order ${order?.orderNumber ?? orderId} marked as delivered`,
      data: { orderId },
      dedupeKey: `order.delivered:${orderId}`,
    });
  }

  private async onOrderDeleted(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const orderId = str(payload.orderId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'order_deleted',
      title: 'Order Deleted',
      message: `Order ${orderId} was ${payload.permanent === true ? 'permanently deleted' : 'moved to the recycle bin'}`,
      data: { orderId },
      priority: 'low',
      dedupeKey: `order.deleted:${orderId}:${str(event_key(payload))}`,
    });
  }

  // ── Payment handlers ─────────────────────────────────────────────────────────
  private async onPaymentSucceeded(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const paymentId = str(payload.paymentId);
    const payment = paymentId ? await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } }) : null;
    await this.notifications.create(tx, {
      tenantId,
      type: 'payment_confirmed',
      title: 'Payment Received',
      message: `Payment of ${str(payload.currency ?? payment?.currency)} ${num(payload.amount ?? payment?.amount).toLocaleString()} received via ${str(payload.provider ?? payment?.provider)}`,
      data: { paymentId, orderId: str(payload.orderId ?? payment?.orderId) },
      priority: 'high',
      dedupeKey: `payment.succeeded:${paymentId}`,
    });
    if (paymentId) await this.receipts.createForPayment(tx, paymentId);
  }

  private async onPaymentFailed(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const paymentId = str(payload.paymentId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `A payment failed${payload.reason ? `: ${str(payload.reason)}` : ''}`,
      data: { paymentId, orderId: str(payload.orderId) },
      priority: 'high',
      dedupeKey: `payment.failed:${paymentId}`,
    });
  }

  private async onPaymentRefunded(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const paymentId = str(payload.paymentId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'payment_refunded',
      title: 'Payment Refunded',
      message: `A refund of ${str(payload.currency)} ${num(payload.amount).toLocaleString()} was issued`,
      data: { paymentId, refundId: str(payload.refundId) },
      dedupeKey: `payment.refunded:${str(payload.refundId ?? paymentId)}`,
    });
  }

  // A provider payment succeeded while the order was not yet payable (e.g. still
  // PENDING). The money is recorded; surface it so an operator can approve and
  // settle the order.
  private async onPaymentAwaitingApproval(tenantId: string, payload: Record<string, unknown>, tx: Prisma.TransactionClient): Promise<void> {
    const paymentId = str(payload.paymentId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'payment_awaiting_order_approval',
      title: 'Payment received — action needed',
      message: `A payment of ${str(payload.currency)} ${num(payload.amount).toLocaleString()} was received for an order that is not yet approved. Approve the order to settle it.`,
      data: { paymentId, orderId: str(payload.orderId) },
      priority: 'critical',
      dedupeKey: `payment.awaiting_order_approval:${paymentId}`,
    });
  }

  // ── Stock handlers ───────────────────────────────────────────────────────────
  private async onLowStock(tenantId: string, event: OutboxEventRecord, tx: Prisma.TransactionClient): Promise<void> {
    const productId = str(event.payload.productId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'low_stock',
      title: 'Low Stock Alert',
      message: `${str(event.payload.name)} is low on stock (${num(event.payload.stock)} left, threshold ${num(event.payload.threshold)})`,
      data: { productId, stock: num(event.payload.stock) },
      priority: 'high',
      // Include the event id so recurring threshold crossings each notify.
      dedupeKey: `product.low_stock:${productId}:${event.id}`,
    });
  }

  private async onOutOfStock(tenantId: string, event: OutboxEventRecord, tx: Prisma.TransactionClient): Promise<void> {
    const productId = str(event.payload.productId);
    await this.notifications.create(tx, {
      tenantId,
      type: 'out_of_stock',
      title: 'Out of Stock',
      message: `${str(event.payload.name)} is now out of stock`,
      data: { productId, stock: 0 },
      priority: 'critical',
      dedupeKey: `product.out_of_stock:${productId}:${event.id}`,
    });
  }

  // ── WhatsApp handlers ────────────────────────────────────────────────────────
  // Transactional intent → durable queued message; the outbound sender delivers.
  private async onWhatsAppSend(
    tenantId: string,
    payload: Record<string, unknown>,
    tx: Prisma.TransactionClient
  ): Promise<void> {
    await this.whatsapp.enqueue(tx, {
      tenantId,
      to: str(payload.to),
      text: payload.text != null ? str(payload.text) : undefined,
      templateName: payload.templateName != null ? str(payload.templateName) : undefined,
      messageType: payload.messageType != null ? str(payload.messageType) : undefined,
      idempotencyKey: payload.idempotencyKey != null ? str(payload.idempotencyKey) : null,
      raw: (payload.raw as Record<string, unknown>) ?? {},
    });
  }

  // Telemetry/audit consumer. The conversation flow itself runs in the API
  // (ConversationService) where the Catalog/Commerce/Finance domains live, so
  // business rules are never duplicated in the worker.
  private onWhatsAppInbound(tenantId: string, payload: Record<string, unknown>): void {
    this.logger.log(`whatsapp.inbound tenant=${tenantId} phone=${str(payload.contactPhone)} type=${str(payload.messageType)}`);
  }

  private receiptEmailHtml(order: { orderNumber: string; currency: string; total: unknown }, receiptId: string | null): string {
    const base = process.env.PUBLIC_APP_URL ?? '';
    const link = receiptId && base ? `<p><a href="${base}/api/v1/receipts/${receiptId}/html">View receipt</a></p>` : '';
    return `<div style="font-family:Arial,sans-serif">
      <h2>Thank you for your order</h2>
      <p>Order <strong>${order.orderNumber}</strong></p>
      <p>Total: <strong>${order.currency} ${num(order.total).toLocaleString()}</strong></p>
      ${link}
    </div>`;
  }
}

// Distinct event key helper for de-duplicating repeatable notifications.
function event_key(payload: Record<string, unknown>): unknown {
  return payload.permanent === true ? 'permanent' : 'soft';
}
