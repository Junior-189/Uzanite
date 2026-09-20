import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildReceiptData, ListReceiptsQuery, ReceiptData } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (amount: number, currency: string): string =>
  `${escapeHtml(currency)} ${Number(amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: ReceiptPdfService,
    private readonly outbox: OutboxService
  ) {}

  /** Renders (generating if needed) an order's receipt as a PDF buffer. */
  async pdfForOrder(tenantId: string, orderId: string): Promise<Buffer> {
    let receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, orderId, type: 'order' } });
    if (!receipt) {
      await this.generateForOrder(tenantId, orderId);
      receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, orderId, type: 'order' } });
    }
    if (!receipt) throw new NotFoundException('Receipt not found for this order');
    return this.pdf.render(receipt.data as unknown as ReceiptData);
  }

  /** Queues delivery of an order's receipt (worker sends it). */
  async sendReceipt(tenantId: string, orderId: string) {
    const order = await this.prisma.db.order.findFirst({ where: { id: orderId, tenantId, deletedAt: null }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    await this.outbox.enqueue({ type: 'receipt.send', tenantId, payload: { orderId } });
    return { success: true, message: 'Receipt queued for delivery' };
  }

  async list(tenantId: string, query: ListReceiptsQuery) {
    const where: Prisma.ReceiptWhereInput = { tenantId };
    if (query.type) where.type = query.type;
    if (query.orderId) where.orderId = query.orderId;
    if (query.paymentId) where.paymentId = query.paymentId;
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.receipt.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, receipts: page.items, nextCursor: page.nextCursor };
  }

  private async getRaw(tenantId: string, id: string) {
    const receipt = await this.prisma.db.receipt.findFirst({ where: { id, tenantId } });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  async get(tenantId: string, id: string) {
    return { success: true, receipt: await this.getRaw(tenantId, id) };
  }

  async getByOrder(tenantId: string, orderId: string) {
    const receipt = await this.prisma.db.receipt.findFirst({
      where: { tenantId, orderId, type: 'order' },
      orderBy: { createdAt: 'desc' },
    });
    if (!receipt) throw new NotFoundException('Receipt not found for this order');
    return { success: true, receipt };
  }

  // Idempotent: one order receipt per order.
  async generateForOrder(tenantId: string, orderId: string) {
    const existing = await this.prisma.db.receipt.findFirst({ where: { tenantId, orderId, type: 'order' } });
    if (existing) return { success: true, receipt: existing, idempotent: true };

    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      include: { items: { orderBy: { createdAt: 'asc' } }, tenant: true },
    });
    if (!order) throw new NotFoundException('Order not found');

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
      items: order.items.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: Number(i.price),
        subtotal: Number(i.subtotal),
      })),
      payment: null,
    });

    // ON CONFLICT DO NOTHING (skipDuplicates) so a concurrent create cannot
    // abort the request transaction (under RLS the whole request is one tx).
    const id = newId();
    const res = await this.prisma.db.receipt.createMany({
      data: [
        {
          id,
          tenantId,
          type: 'order',
          orderId,
          receiptNumber,
          currency: order.currency,
          amount: String(order.total),
          data: data as unknown as object,
          dedupeKey: `order:${orderId}`,
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      return this.get(tenantId, id).then((r) => ({ success: true, receipt: r.receipt, idempotent: false }));
    }
    const receipt = await this.prisma.db.receipt.findFirst({ where: { tenantId, orderId, type: 'order' } });
    return { success: true, receipt, idempotent: true };
  }

  async renderHtml(tenantId: string, id: string): Promise<string> {
    const receipt = await this.getRaw(tenantId, id);
    return this.toHtml(receipt.data as unknown as ReceiptData);
  }

  private toHtml(data: ReceiptData): string {
    const rows = data.order.items
      .map(
        (i) => `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(i.productName)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.price, data.order.currency)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(i.subtotal, data.order.currency)}</td>
        </tr>`
      )
      .join('');

    const paymentLine = data.payment
      ? `<p style="margin:4px 0;color:#555">Paid via ${escapeHtml(data.payment.method)} (${escapeHtml(data.payment.provider)})${data.payment.reference ? ` — ref ${escapeHtml(data.payment.reference)}` : ''}</p>`
      : '';

    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${escapeHtml(data.receiptNumber)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;margin:0;padding:24px;color:#111">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:24px">
    <h1 style="margin:0 0 4px;font-size:20px">${escapeHtml(data.business.name)}</h1>
    <div style="color:#777;font-size:12px;letter-spacing:1px;text-transform:uppercase">Sales Receipt</div>
    <hr style="border:none;border-top:1px dashed #ccc;margin:16px 0">
    <p style="margin:4px 0"><strong>Receipt:</strong> ${escapeHtml(data.receiptNumber)}</p>
    <p style="margin:4px 0"><strong>Order:</strong> ${escapeHtml(data.order.number)} &nbsp; <strong>Status:</strong> ${escapeHtml(data.order.status)}</p>
    <p style="margin:4px 0"><strong>Date:</strong> ${escapeHtml(new Date(data.order.createdAt).toLocaleString('en-GB'))}</p>
    <p style="margin:4px 0"><strong>Customer:</strong> ${escapeHtml(data.customer.name)}${data.customer.phone ? ` — ${escapeHtml(data.customer.phone)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #111">Item</th>
        <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #111">Qty</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #111">Price</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #111">Subtotal</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:right;font-size:18px;font-weight:bold">Total: ${money(data.totals.total, data.totals.currency)}</div>
    ${paymentLine}
    <hr style="border:none;border-top:1px dashed #ccc;margin:16px 0">
    <p style="color:#888;font-size:12px;text-align:center;margin:0">Thank you for your business.</p>
  </div>
</body></html>`;
  }
}
