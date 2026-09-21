import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';
import { ConfirmManualPaymentInput, InitiatePaymentInput, ListPaymentsQuery, RefundPaymentInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../../metrics/metrics.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { decryptPii } from '../../security/pii';
import { runAsSystem } from '../../context/tenant-context';
import { OutboxService } from '../../outbox/outbox.service';
import { OrdersService } from '../commerce/orders.service';
import { LedgerService } from './ledger.service';
import { PaymentAdaptersService } from './payments/payment-adapters.service';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// Provider status -> canonical PaymentStatus.
function mapStatus(raw?: string): PaymentStatus {
  const s = String(raw ?? '').toLowerCase();
  if (['success', 'succeeded', 'completed', 'paid', 'settled'].includes(s)) return 'succeeded';
  if (['failed', 'error', 'declined', 'rejected'].includes(s)) return 'failed';
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled';
  if (['processing', 'in_progress'].includes(s)) return 'processing';
  return 'pending';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly adapters: PaymentAdaptersService,
    private readonly metrics?: MetricsService
  ) {}

  private serialize<T extends { id: string }>(payment: T): T & { _id: string } {
    return { ...payment, _id: payment.id };
  }

  private async getOrderOrThrow(tenantId: string, orderId: string) {
    const order = await this.prisma.db.order.findFirst({ where: { id: orderId, tenantId, deletedAt: null } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async recordAttempt(
    payment: { id: string; tenantId: string; provider: string },
    status: string,
    request: Record<string, unknown>,
    response: Record<string, unknown>,
    error = ''
  ): Promise<void> {
    await this.prisma.db.paymentAttempt.create({
      data: {
        id: newId(),
        tenantId: payment.tenantId,
        paymentId: payment.id,
        provider: payment.provider,
        status,
        request: request as object,
        response: response as object,
        error,
      },
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────
  async list(tenantId: string, query: ListPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.provider) where.provider = query.provider;
    if (query.orderId) where.orderId = query.orderId;
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.payment.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const payments = page.items.map((p) => this.serialize(p as { id: string }));
    return { success: true, count: payments.length, payments, nextCursor: page.nextCursor };
  }

  async listForOrder(tenantId: string, orderId: string) {
    await this.getOrderOrThrow(tenantId, orderId);
    const payments = await this.prisma.db.payment.findMany({
      where: { tenantId, orderId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, count: payments.length, payments: payments.map((p) => this.serialize(p)) };
  }

  async get(tenantId: string, id: string) {
    const payment = await this.prisma.db.payment.findFirst({ where: { id, tenantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    return { success: true, payment: this.serialize(payment) };
  }

  // ── Initiate ─────────────────────────────────────────────────────────────────
  // The provider network call is performed OUTSIDE any database transaction:
  // phase 1 persists the `initiated` payment, phase 2 calls the provider, phase
  // 3 records the outcome. This avoids holding a DB connection open for the
  // duration of an external HTTP call.
  // This handler opts out of the request-wide RLS transaction
  // (`@NoRequestTransaction`) so each DB phase runs in its own short transaction
  // via `PrismaService.withTenant`, and the provider network call runs between
  // them with NO transaction held.
  async initiate(tenantId: string, orderId: string, input: InitiatePaymentInput, actor: string) {
    const adapter = this.adapters.get(input.provider);
    if (!adapter) throw new BadRequestException(`Unknown payment provider: ${input.provider}`);

    // Phase 1 (short DB tx): validate, enforce idempotency, create/update payment.
    const prepared = await this.prisma.withTenant(tenantId, async () => {
      const order = await this.getOrderOrThrow(tenantId, orderId);
      if (order.status === 'PAID' || order.status === 'DELIVERED') {
        throw new ConflictException('Order is already paid');
      }

      const idempotencyKey = `order:${orderId}:${adapter.name}`;
      const existing = await this.prisma.db.payment.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing && ['pending', 'processing', 'succeeded'].includes(existing.status)) {
        return { shortCircuit: existing, order, payment: existing };
      }

      const payment = existing
        ? await this.prisma.db.payment.update({ where: { id: existing.id }, data: { status: 'initiated' } })
        : await this.prisma.db.payment.create({
            data: {
              id: newId(),
              tenantId,
              orderId,
              provider: adapter.name,
              method: input.method,
              idempotencyKey,
              amount: String(order.total),
              currency: order.currency,
              phone: input.phone ?? decryptPii(order.customerPhone),
              status: 'initiated',
              initiatedBy: actor,
            },
          });
      return { shortCircuit: null, order, payment };
    });

    if (prepared.shortCircuit) {
      return { success: true, payment: this.serialize(prepared.shortCircuit), idempotent: true };
    }
    const { order, payment } = prepared;

    // Provider disabled (e.g. manual): park as pending with no network call.
    if (!adapter.enabled()) {
      const result = await this.prisma.withTenant(tenantId, async () => {
        await this.prisma.db.payment.update({ where: { id: payment.id }, data: { status: 'pending' } });
        await this.recordAttempt(payment, 'pending', { orderId }, { disabled: true });
        return this.get(tenantId, payment.id);
      });
      return result;
    }

    // Phase 2 (network I/O, NO transaction held): call the provider.
    let result;
    try {
      result = await adapter.initiate({
        tenantId,
        paymentId: payment.id,
        orderId,
        amount: Number(order.total),
        currency: order.currency,
        phone: input.phone ?? decryptPii(order.customerPhone),
        method: input.method,
        reference: payment.id,
      });
    } catch (err) {
      await this.prisma.withTenant(tenantId, async () => {
        await this.prisma.db.payment.update({
          where: { id: payment.id },
          data: { status: 'failed', failureReason: (err as Error).message },
        });
        await this.recordAttempt(payment, 'failed', { orderId }, {}, (err as Error).message);
      });
      throw err;
    }

    // Phase 3 (short DB tx): persist the provider result and enqueue the event.
    return this.prisma.withTenant(tenantId, async () => {
      await this.prisma.db.payment.update({
        where: { id: payment.id },
        data: {
          providerRef: result.providerRef ?? null,
          status: mapStatus(result.status),
          raw: (result.raw ?? {}) as object,
        },
      });
      await this.recordAttempt(payment, result.status, { orderId }, (result.raw ?? {}) as Record<string, unknown>);
      await this.outbox.enqueue({
        type: 'payment.initiated',
        tenantId,
        payload: { paymentId: payment.id, orderId, provider: adapter.name, amount: Number(order.total) },
      });
      return this.get(tenantId, payment.id);
    });
  }

  // ── Manual confirmation (Payment + Order PAID + Ledger, atomic) ──────────────
  async confirmManual(tenantId: string, orderId: string, input: ConfirmManualPaymentInput, actor: string) {
    const paymentId = await this.prisma.transaction(async () => {
      const order = await this.getOrderOrThrow(tenantId, orderId);

      // Idempotency: an already-settled order returns its payment.
      if (order.status === 'PAID' || order.status === 'DELIVERED') {
        const settled = await this.prisma.db.payment.findFirst({
          where: { tenantId, orderId, status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
        });
        if (settled) return { id: settled.id, idempotent: true };

        // Cash/POS orders settle at creation with a `cash_sale` ledger credit
        // and no Payment row. Crediting again here would double-count revenue.
        const orderCredit = await this.prisma.db.ledgerEntry.findFirst({
          where: { tenantId, refType: 'order', refId: orderId, direction: 'credit' },
          select: { id: true },
        });
        if (orderCredit) {
          throw new ConflictException('Order is already settled; no manual payment is required.');
        }
      }

      const idempotencyKey = `order:${orderId}:manual:${input.reference}`;
      const existing = await this.prisma.db.payment.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing && existing.status === 'succeeded') return { id: existing.id, idempotent: true };

      const payment = existing
        ? await this.prisma.db.payment.update({ where: { id: existing.id }, data: { status: 'succeeded', confirmedAt: new Date() } })
        : await this.prisma.db.payment.create({
            data: {
              id: newId(),
              tenantId,
              orderId,
              provider: 'manual',
              method: input.method,
              providerRef: `manual:${newId()}`,
              idempotencyKey,
              amount: String(order.total),
              currency: order.currency,
              phone: decryptPii(order.customerPhone),
              status: 'succeeded',
              proofPath: input.proofPath ?? null,
              raw: { reference: input.reference } as object,
              confirmedAt: new Date(),
              initiatedBy: actor,
            },
          });

      // Order -> PAID (same transaction).
      await this.orders.markPaid(tenantId, orderId, {
        method: input.method,
        reference: input.reference,
        proofPath: input.proofPath ?? null,
        actor,
      });

      // Append-only ledger credit (idempotent by payment id).
      await this.ledger.record({
        tenantId,
        type: 'payment_in',
        direction: 'credit',
        amount: Number(order.total),
        currency: order.currency,
        refType: 'payment',
        refId: payment.id,
        dedupeKey: `payment:${payment.id}`,
        description: `Manual payment (${input.method})`,
        meta: { orderId, reference: input.reference, provider: 'manual' },
        recordedBy: actor,
      });

      await this.outbox.enqueue({
        type: 'payment.succeeded',
        tenantId,
        payload: { paymentId: payment.id, orderId, amount: Number(order.total), currency: order.currency, provider: 'manual' },
      });
      return { id: payment.id, idempotent: false };
    });

    const result = await this.get(tenantId, paymentId.id);
    return { ...result, idempotent: paymentId.idempotent };
  }

  // ── Provider result (webhook) — idempotent, system context ───────────────────
  async applyProviderResult(input: {
    providerName: string;
    providerRef: string;
    status?: string;
    amount?: number;
    currency?: string;
    failureReason?: string;
    raw?: Record<string, unknown>;
  }): Promise<{ matched: boolean; duplicate?: boolean; paymentId?: string }> {
    if (!input.providerRef) return { matched: false };

    return runAsSystem(() =>
      this.prisma.transaction(async () => {
        const payment = await this.prisma.db.payment.findFirst({ where: { providerRef: input.providerRef } });
        if (!payment) {
          this.metrics?.observePaymentWebhook(input.providerName, 'unmatched');
          return { matched: false };
        }

        // Replay of an already-succeeded payment is a no-op.
        if (payment.status === 'succeeded' || payment.status === 'refunded') {
          this.metrics?.observePaymentWebhook(input.providerName, 'duplicate');
          return { matched: true, duplicate: true, paymentId: payment.id };
        }

        let mapped = mapStatus(input.status);

        // Integrity: never credit a different amount/currency than recorded.
        let mismatch = false;
        if (mapped === 'succeeded') {
          if (input.currency && input.currency.toUpperCase() !== payment.currency) {
            mapped = 'failed';
            mismatch = true;
            input.failureReason = `Currency mismatch (expected ${payment.currency}, got ${input.currency})`;
          } else if (input.amount !== undefined && round2(input.amount) !== Number(payment.amount)) {
            mapped = 'failed';
            mismatch = true;
            input.failureReason = `Amount mismatch (expected ${payment.amount}, got ${input.amount})`;
          }
        }

        await this.prisma.db.payment.update({
          where: { id: payment.id },
          data: {
            status: mapped,
            failureReason: mapped === 'failed' ? input.failureReason || 'Payment failed' : '',
            confirmedAt: mapped === 'succeeded' ? new Date() : payment.confirmedAt,
            raw: (input.raw ?? payment.raw) as object,
          },
        });
        await this.recordAttempt(payment, mapped, {}, input.raw ?? {});
        this.metrics?.observePaymentWebhook(input.providerName, mapped);

        if (mismatch) {
          // A genuinely-paid transaction was auto-failed on a mismatch; surface
          // it to the operator for manual review instead of losing it silently.
          await this.prisma.db.notification.createMany({
            data: [{
              id: newId(),
              tenantId: payment.tenantId,
              type: 'payment_awaiting_review',
              title: 'Payment needs review',
              message: input.failureReason || 'A provider payment did not match the order',
              priority: 'high',
              dedupeKey: `payment-review:${payment.id}`,
              data: { paymentId: payment.id, orderId: payment.orderId, provider: input.providerName } as object,
            }],
            skipDuplicates: true,
          });
          await this.outbox.enqueue({
            type: 'payment.awaiting_review',
            tenantId: payment.tenantId,
            payload: { paymentId: payment.id, orderId: payment.orderId, reason: input.failureReason ?? '' },
          });
        }

        if (mapped === 'succeeded') {
          // The money has arrived. Record it regardless of the order's workflow
          // state: if the order is not yet payable (e.g. still PENDING), do NOT
          // throw (which would roll back and make the provider retry forever).
          // Mark the payment succeeded and flag the order for reconciliation.
          let orderSettled = true;
          if (payment.orderId) {
            try {
              await this.orders.markPaid(payment.tenantId, payment.orderId, {
                method: payment.method,
                reference: input.providerRef,
                actor: payment.initiatedBy || input.providerName,
              });
            } catch (err) {
              if (err instanceof ConflictException) {
                orderSettled = false;
                this.logger.warn(
                  `Payment ${payment.id} succeeded but order ${payment.orderId} could not be settled: ${err.message}`
                );
              } else {
                throw err;
              }
            }
          }
          await this.ledger.record({
            tenantId: payment.tenantId,
            type: 'payment_in',
            direction: 'credit',
            amount: Number(payment.amount),
            currency: payment.currency,
            refType: 'payment',
            refId: payment.id,
            dedupeKey: `payment:${payment.id}`,
            description: `Payment via ${input.providerName}`,
            meta: { providerRef: input.providerRef, provider: input.providerName, orderId: payment.orderId },
            recordedBy: payment.initiatedBy,
          });
          await this.outbox.enqueue({
            type: 'payment.succeeded',
            tenantId: payment.tenantId,
            payload: {
              paymentId: payment.id,
              orderId: payment.orderId,
              amount: Number(payment.amount),
              currency: payment.currency,
              provider: input.providerName,
            },
          });
          if (!orderSettled && payment.orderId) {
            await this.outbox.enqueue({
              type: 'payment.awaiting_order_approval',
              tenantId: payment.tenantId,
              payload: {
                paymentId: payment.id,
                orderId: payment.orderId,
                amount: Number(payment.amount),
                currency: payment.currency,
              },
            });
          }
        } else if (mapped === 'failed') {
          await this.outbox.enqueue({
            type: 'payment.failed',
            tenantId: payment.tenantId,
            payload: { paymentId: payment.id, orderId: payment.orderId, reason: input.failureReason ?? '' },
          });
        }

        return { matched: true, paymentId: payment.id };
      })
    );
  }

  // ── Refund (debit ledger, strictly bounded) ──────────────────────────────────
  async refund(tenantId: string, paymentId: string, input: RefundPaymentInput, actor: string) {
    const refundId = await this.prisma.transaction(async () => {
      const payment = await this.prisma.db.payment.findFirst({ where: { id: paymentId, tenantId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== 'succeeded' && payment.status !== 'refunded') {
        throw new ConflictException('Only a succeeded payment can be refunded');
      }

      // Serialize concurrent refunds for the same payment: hold a row lock for
      // the remainder of the transaction so two requests cannot both pass the
      // cumulative "remaining refundable" check.
      await this.prisma.db.$queryRaw`
        SELECT "id" FROM "payments" WHERE "id" = ${paymentId}::uuid AND "tenant_id" = ${tenantId}::uuid FOR UPDATE
      `;

      const idempotencyKey = input.clientRef?.trim() ? input.clientRef.trim() : null;
      if (idempotencyKey) {
        const existing = await this.prisma.db.refund.findFirst({ where: { tenantId, idempotencyKey } });
        if (existing) return existing.id;
      }

      const agg = await this.prisma.db.refund.aggregate({
        where: { tenantId, paymentId, status: 'succeeded' },
        _sum: { amount: true },
      });
      const already = Number(agg._sum.amount ?? 0);
      const remaining = round2(Number(payment.amount) - already);
      const amount = round2(input.amount);
      if (amount > remaining) {
        throw new ConflictException(`Refund exceeds remaining refundable amount (${remaining} ${payment.currency})`);
      }

      const refund = await this.prisma.db.refund.create({
        data: {
          id: newId(),
          tenantId,
          paymentId,
          orderId: payment.orderId,
          amount: String(amount),
          currency: payment.currency,
          reason: input.reason,
          idempotencyKey,
          recordedBy: actor,
        },
      });

      await this.ledger.record({
        tenantId,
        type: 'refund',
        direction: 'debit',
        amount,
        currency: payment.currency,
        refType: 'refund',
        refId: refund.id,
        dedupeKey: `refund:${refund.id}`,
        description: input.reason || 'Refund',
        meta: { paymentId, orderId: payment.orderId },
        recordedBy: actor,
      });

      if (amount >= remaining) {
        await this.prisma.db.payment.update({ where: { id: paymentId }, data: { status: 'refunded' } });
        // Full refund: return the goods to stock so inventory and the books agree.
        if (payment.orderId) {
          await this.orders.restoreStockForRefund(tenantId, payment.orderId, actor);
        }
      }

      await this.outbox.enqueue({
        type: 'payment.refunded',
        tenantId,
        payload: { paymentId, refundId: refund.id, amount, currency: payment.currency },
      });
      return refund.id;
    });

    const refund = await this.prisma.db.refund.findFirst({ where: { id: refundId, tenantId } });
    return { success: true, refund };
  }

  providers() {
    return this.adapters.list();
  }
}
