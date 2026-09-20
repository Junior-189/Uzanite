import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildReceiptData } from '@uzanite/contracts';
import { randomUUID } from 'crypto';

/**
 * Builds and stores structured receipts from outbox events. Idempotent via the
 * unique (tenant_id, dedupe_key) index: one order receipt per order and one
 * payment receipt per payment.
 */
@Injectable()
export class ReceiptWriter {
  private readonly logger = new Logger(ReceiptWriter.name);

  async createForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<{ id: string; created: boolean } | null> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { createdAt: 'asc' } }, tenant: true },
    });
    if (!order) {
      this.logger.warn(`Receipt requested for unknown order ${orderId}`);
      return null;
    }

    const receiptNumber = `RCP-${order.orderNumber}`;
    const data = buildReceiptData({
      receiptNumber,
      business: { name: order.tenant.name, phone: order.tenant.phone, currency: order.tenant.currency },
      customer: {
        name: order.customerName,
        phone: order.customerPhone,
        email: order.customerEmail,
        deliveryLocation: order.deliveryLocation,
      },
      order: {
        id: order.id,
        number: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        total: Number(order.total),
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentReference,
      },
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, price: Number(i.price), subtotal: Number(i.subtotal) })),
      payment: null,
    });

    return this.store(tx, order.tenantId, {
      type: 'order',
      orderId,
      paymentId: null,
      receiptNumber,
      currency: order.currency,
      amount: order.total,
      dedupeKey: `order:${orderId}`,
      data,
    });
  }

  async createForPayment(tx: Prisma.TransactionClient, paymentId: string): Promise<{ id: string; created: boolean } | null> {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { items: { orderBy: { createdAt: 'asc' } } } }, tenant: true },
    });
    if (!payment) {
      this.logger.warn(`Receipt requested for unknown payment ${paymentId}`);
      return null;
    }

    const order = payment.order;
    const receiptNumber = order ? `RCP-${order.orderNumber}-P` : `RCP-PAY-${paymentId.slice(0, 8)}`;
    const data = buildReceiptData({
      receiptNumber,
      business: { name: payment.tenant.name, phone: payment.tenant.phone, currency: payment.currency },
      customer: order
        ? { name: order.customerName, phone: order.customerPhone, email: order.customerEmail, deliveryLocation: order.deliveryLocation }
        : { name: 'Customer', phone: payment.phone, email: null, deliveryLocation: null },
      order: {
        id: order?.id ?? paymentId,
        number: order?.orderNumber ?? receiptNumber,
        status: order?.status ?? 'PAID',
        createdAt: order?.createdAt ?? payment.createdAt,
        total: Number(payment.amount),
        currency: payment.currency,
        paymentMethod: payment.method,
        paymentReference: payment.providerRef,
      },
      items: order
        ? order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, price: Number(i.price), subtotal: Number(i.subtotal) }))
        : [],
      payment: {
        id: payment.id,
        provider: payment.provider,
        method: payment.method,
        reference: payment.providerRef,
        amount: Number(payment.amount),
        currency: payment.currency,
        confirmedAt: payment.confirmedAt,
      },
    });

    return this.store(tx, payment.tenantId, {
      type: 'payment',
      orderId: order?.id ?? null,
      paymentId,
      receiptNumber,
      currency: payment.currency,
      amount: payment.amount,
      dedupeKey: `payment:${paymentId}`,
      data,
    });
  }

  private async store(
    tx: Prisma.TransactionClient,
    tenantId: string,
    input: {
      type: 'order' | 'payment';
      orderId: string | null;
      paymentId: string | null;
      receiptNumber: string;
      currency: string;
      amount: Prisma.Decimal | number | string;
      dedupeKey: string;
      data: object;
    }
  ): Promise<{ id: string; created: boolean }> {
    const id = randomUUID();
    // ON CONFLICT DO NOTHING (skipDuplicates) keeps the transaction alive on a
    // replay, unlike catching P2002.
    const res = await tx.receipt.createMany({
      data: [
        {
          id,
          tenantId,
          type: input.type,
          orderId: input.orderId,
          paymentId: input.paymentId,
          receiptNumber: input.receiptNumber,
          currency: input.currency,
          amount: String(input.amount),
          data: input.data as object,
          dedupeKey: input.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) return { id, created: true };
    const existing = await tx.receipt.findFirst({ where: { tenantId, dedupeKey: input.dedupeKey } });
    return { id: existing?.id ?? id, created: false };
  }
}
