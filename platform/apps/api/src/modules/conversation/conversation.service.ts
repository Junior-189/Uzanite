import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListFlowTracesQuery } from '@uzanite/contracts';
import { normalizeRecipient } from '@uzanite/messaging';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../pagination/pagination';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { ProductsService } from '../catalog/products.service';
import { OrdersService } from '../commerce/orders.service';
import { PaymentsService } from '../finance/payments.service';
import { WhatsAppService } from '../messaging/whatsapp.service';
import { InboundDescriptor } from '../messaging/whatsapp-webhook.service';
import { runAsSystem } from '../../context/tenant-context';
import { newId } from '../../ids/id';
import { handleCustomerFlow } from './flows/customer-flow';
import { handleAdminFlow } from './flows/admin-flow';
import { t } from './flows/i18n';
import { ActionResult, CartItem, CreateOrderInput, FlowDeps, FlowResult, FlowState, OrderView, ProductView, Reply, STEPS } from './flows/types';

type ConversationRow = { id: string; step: string; language: string; cart: unknown; context: unknown; lastActivityAt: Date; version: number };

// Sessions idle for longer than this are reset (mirrors the legacy 2h TTL).
const INACTIVITY_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly whatsapp: WhatsAppService
  ) {}

  /**
   * Process a recorded inbound message. Resolves the tenant's rollout mode:
   *  - off:     Express owns the flow (no-op here)
   *  - shadow:  run the flow for parity logging, do NOT send replies
   *  - active:  run the flow and enqueue replies via the durable send path
   * A paused bot records the decision but never replies.
   */
  async processInbound(ev: InboundDescriptor): Promise<void> {
    await runAsSystem(() =>
      this.prisma.transaction(async () => {
        const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId: ev.tenantId } });
        const mode = account?.flowMode ?? ((process.env.WHATSAPP_FLOW_MODE as 'off' | 'shadow' | 'active') || 'off');
        if (mode === 'off') {
          this.logger.debug(`flow off for tenant ${ev.tenantId} — Express handles inbound`);
          return;
        }

        const paused = !!account?.botPaused;
        const { state, conversationId, version, reset } = await this.loadState(ev.tenantId, ev.phone);
        if (reset) this.logger.log(`conversation reset after inactivity tenant=${ev.tenantId} phone=${ev.phone}`);

        const deps = await this.buildDeps(ev, state);
        const isAdmin = await this.isAdmin(ev.tenantId, ev.phone);
        const input = ev.interactiveId ?? ev.text;

        let result: FlowResult;
        if (isAdmin) {
          result = (await handleAdminFlow(deps, state, input)) ?? (await handleCustomerFlow(deps, state, input));
        } else {
          result = await handleCustomerFlow(deps, state, input);
        }

        const stepTo = result.step ?? state.step;
        await this.persistState(ev.tenantId, ev.phone, state, result, version);
        await this.recordTrace({
          tenantId: ev.tenantId,
          conversationId,
          contactPhone: ev.phone,
          mode: paused ? 'paused' : mode,
          admin: isAdmin,
          input,
          stepFrom: state.step,
          stepTo,
          replies: result.replies,
        });

        this.logger.log(
          `flow[${paused ? 'paused' : mode}] tenant=${ev.tenantId} phone=${ev.phone} admin=${isAdmin} step=${state.step}->${stepTo} replies=${result.replies.length}`
        );

        if (mode === 'active' && !paused) {
          await this.sendReplies(ev, result.replies);
        }
      })
    );
  }

  /** Enqueue a fallback reply and reset state when a flow throws. */
  async handleFailure(ev: InboundDescriptor): Promise<void> {
    try {
      await runAsSystem(() =>
        this.prisma.transaction(async () => {
          const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId: ev.tenantId } });
          const mode = account?.flowMode ?? ((process.env.WHATSAPP_FLOW_MODE as 'off' | 'shadow' | 'active') || 'off');
          if (mode !== 'active' || account?.botPaused) return;
          await this.prisma.db.conversation.updateMany({
            where: { tenantId: ev.tenantId, contactPhone: ev.phone },
            data: { step: STEPS.MAIN_MENU, cart: [], context: {}, lastActivityAt: new Date() },
          });
          await this.whatsapp.enqueueText(
            ev.tenantId,
            { to: ev.phone, text: t('fallback.error', 'sw'), idempotencyKey: `conv:${ev.providerMessageId}:fallback` } as never,
            'flow'
          );
        })
      );
    } catch (err) {
      this.logger.error(`Failed to enqueue fallback reply: ${(err as Error).message}`);
    }
  }

  /** Recent flow decisions for parity review (shadow mode). */
  async listTraces(tenantId: string, query: ListFlowTracesQuery) {
    const where: Prisma.FlowTraceWhereInput = { tenantId };
    if (query.contactPhone) where.contactPhone = normalizeRecipient(query.contactPhone);
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.flowTrace.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, traces: page.items, nextCursor: page.nextCursor };
  }

  /** Reset conversations idle for longer than `maxAgeHours`. Returns the count. */
  async cleanupStale(maxAgeHours = 24): Promise<number> {
    return runAsSystem(() =>
      this.prisma.transaction(async () => {
        const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
        const res = await this.prisma.db.conversation.updateMany({
          where: { lastActivityAt: { lt: cutoff }, step: { not: STEPS.MAIN_MENU } },
          data: { step: STEPS.MAIN_MENU, cart: [], context: {}, lastActivityAt: new Date() },
        });
        return res.count;
      })
    );
  }

  // ── State ────────────────────────────────────────────────────────────────────
  private async loadState(tenantId: string, phone: string): Promise<{ state: FlowState; conversationId: string; version: number; reset: boolean }> {
    // Upsert avoids the find-then-create race (P2002) on the first message.
    let row = (await this.prisma.db.conversation.upsert({
      where: { tenantId_contactPhone: { tenantId, contactPhone: phone } },
      create: { id: newId(), tenantId, contactPhone: phone, step: STEPS.LANGUAGE_SELECT, cart: [], context: {} },
      update: {},
    })) as ConversationRow;

    let reset = false;
    if (Date.now() - new Date(row.lastActivityAt).getTime() > INACTIVITY_MS) {
      await this.prisma.db.conversation.updateMany({
        where: { tenantId, contactPhone: phone },
        data: { step: STEPS.MAIN_MENU, cart: [], context: {}, lastActivityAt: new Date() },
      });
      reset = true;
      row = { ...row, step: STEPS.MAIN_MENU, cart: [], context: {} };
    }

    return {
      conversationId: row.id,
      version: row.version,
      reset,
      state: {
        tenantId,
        phone,
        step: row.step,
        language: row.language,
        cart: Array.isArray(row.cart) ? (row.cart as CartItem[]) : [],
        context: (row.context as Record<string, unknown>) ?? {},
      },
    };
  }

  private async persistState(
    tenantId: string,
    phone: string,
    state: FlowState,
    result: FlowResult,
    expectedVersion: number
  ): Promise<void> {
    const data = {
      step: result.step ?? state.step,
      language: result.language ?? state.language,
      cart: (result.cart ?? state.cart) as unknown as Prisma.InputJsonValue,
      context: (result.context ?? state.context) as unknown as Prisma.InputJsonValue,
      lastActivityAt: new Date(),
      lastOutboundAt: result.replies.length ? new Date() : undefined,
      version: { increment: 1 },
    };
    // Optimistic concurrency: only persist if nobody else advanced the row.
    const res = await this.prisma.db.conversation.updateMany({
      where: { tenantId, contactPhone: phone, version: expectedVersion },
      data,
    });
    if (res.count === 0) {
      // Lost a race with a concurrent inbound message. Re-read (last-writer-wins
      // on the newest version) and apply once more so state is never dropped.
      this.logger.warn(`Conversation state advanced concurrently for ${phone}; re-applying`);
      await this.prisma.db.conversation.updateMany({ where: { tenantId, contactPhone: phone }, data });
    }
  }

  private async recordTrace(input: {
    tenantId: string;
    conversationId: string;
    contactPhone: string;
    mode: string;
    admin: boolean;
    input: string;
    stepFrom: string;
    stepTo: string;
    replies: Reply[];
  }): Promise<void> {
    await this.prisma.db.flowTrace.create({
      data: {
        id: newId(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        contactPhone: input.contactPhone,
        mode: input.mode,
        admin: input.admin,
        input: input.input.slice(0, 1000),
        stepFrom: input.stepFrom,
        stepTo: input.stepTo,
        replies: input.replies as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async sendReplies(ev: InboundDescriptor, replies: Reply[]): Promise<void> {
    for (let i = 0; i < replies.length; i++) {
      const reply = replies[i];
      const idempotencyKey = `conv:${ev.providerMessageId}:${i}`;
      if (reply.buttons || reply.list) {
        const interactive = reply.buttons
          ? { kind: 'buttons' as const, body: reply.text, buttons: reply.buttons, footer: reply.footer }
          : { kind: 'list' as const, body: reply.text, buttonText: reply.list!.buttonText, sections: reply.list!.sections, footer: reply.footer };
        await this.whatsapp.enqueueInteractive(ev.tenantId, { to: ev.phone, reply: interactive, idempotencyKey }, 'flow');
      } else {
        await this.whatsapp.enqueueText(ev.tenantId, { to: ev.phone, text: reply.text, idempotencyKey } as never, 'flow');
      }
    }
  }

  // ── Identity ─────────────────────────────────────────────────────────────────
  private async isAdmin(tenantId: string, phone: string): Promise<boolean> {
    const user = await this.prisma.db.user.findFirst({ where: { phone, deletedAt: null }, select: { id: true, platformRole: true } });
    if (!user) return false;
    if (user.platformRole) return true;
    const membership = await this.prisma.db.membership.findFirst({
      where: { userId: user.id, tenantId, status: 'active' },
      select: { id: true },
    });
    return !!membership;
  }

  // ── Domain port ──────────────────────────────────────────────────────────────
  private async buildDeps(ev: InboundDescriptor, state: FlowState): Promise<FlowDeps> {
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: ev.tenantId }, select: { name: true, phone: true } });

    const toProductView = (p: { id: string; name: string; description: string; price: unknown; minPrice: unknown; currency: string; stock: number; active: boolean }): ProductView => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.price),
      minPrice: Number(p.minPrice),
      currency: p.currency,
      stock: p.stock,
      active: p.active,
    });

    const toOrderView = (o: {
      id: string;
      orderNumber: string;
      status: string;
      currency: string;
      total: unknown;
      customerName: string;
      createdAt: Date;
      items?: Array<{ productName: string; quantity: number; subtotal: unknown }>;
    }): OrderView => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      currency: o.currency,
      total: Number(o.total),
      customerName: o.customerName,
      createdAt: o.createdAt.toISOString(),
      items: (o.items ?? []).map((i) => ({ productName: i.productName, quantity: i.quantity, subtotal: Number(i.subtotal) })),
    });

    const findOrder = async (orderNumber: string) => {
      const res = await this.orders.getByNumber(ev.tenantId, orderNumber);
      return toOrderView(res.order as never);
    };

    const action = async (fn: () => Promise<unknown>, orderNumber: string): Promise<ActionResult> => {
      const existing = await this.orders.getByNumber(ev.tenantId, orderNumber).catch(() => null);
      if (!existing) return { ok: false, error: t('admin.not_found', 'sw', { orderNumber }) };
      try {
        await fn();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    };

    return {
      tenantId: ev.tenantId,
      phone: ev.phone,
      businessName: tenant?.name ?? 'Our Shop',
      businessPhone: tenant?.phone ?? '',
      listProducts: async () => {
        const res = await this.products.list(ev.tenantId, { active: 'true', limit: 50 } as never);
        return (res.products as never[]).map(toProductView);
      },
      getProduct: async (id) => {
        try {
          const res = await this.products.get(ev.tenantId, id);
          return toProductView(res.product as never);
        } catch {
          return null;
        }
      },
      createProduct: async (input) => {
        const res = await this.products.create(ev.tenantId, { name: input.name, description: input.description, price: input.price, stock: input.stock } as never, 'admin');
        return toProductView(res.product as never);
      },
      createOrder: async (input: CreateOrderInput) => {
        const res = await this.orders.create(
          ev.tenantId,
          {
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            deliveryLocation: input.deliveryLocation,
            deliveryPhone: input.deliveryPhone,
            source: 'whatsapp',
            items: input.items,
            offeredTotal: input.offeredTotal,
          } as never,
          input.customerName || 'Customer'
        );
        return toOrderView(res.order as never);
      },
      listCustomerOrders: async () => {
        const res = await this.orders.list(ev.tenantId, { customerPhone: ev.phone, limit: 5 } as never);
        return (res.orders as never[]).map(toOrderView);
      },
      getOrderByNumber: findOrder,
      findPaymentPendingOrder: async () => {
        for (const status of ['PENDING_PAYMENT', 'APPROVED'] as const) {
          const res = await this.orders.list(ev.tenantId, { customerPhone: ev.phone, status, limit: 1 } as never);
          const first = (res.orders as never[])[0];
          if (first) return toOrderView(first);
        }
        return null;
      },
      submitPaymentProof: (orderNumber, reference) =>
        action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.orders.markPaymentSubmitted(ev.tenantId, id, reference, 'customer')), orderNumber),
      listAdminOrders: async (status) => {
        const res = await this.orders.list(ev.tenantId, { status: status as never, limit: 10 } as never);
        return (res.orders as never[]).map(toOrderView);
      },
      approveOrder: (orderNumber, note) => action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.orders.approve(ev.tenantId, id, note, 'admin')), orderNumber),
      rejectOrder: (orderNumber, reason) => action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.orders.reject(ev.tenantId, id, reason, 'admin')), orderNumber),
      requestPayment: (orderNumber) => action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.orders.requestPayment(ev.tenantId, id, 'admin')), orderNumber),
      confirmPayment: (orderNumber, method, reference) =>
        action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.payments.confirmManual(ev.tenantId, id, { method, reference } as never, 'admin')), orderNumber),
      deliverOrder: (orderNumber, note) => action(() => this.resolveAnd(ev.tenantId, orderNumber, (id) => this.orders.deliver(ev.tenantId, id, note, 'admin')), orderNumber),
      log: (decision, data) => this.logger.log(`flow-decision ${decision} tenant=${ev.tenantId} phone=${ev.phone} ${JSON.stringify(data ?? {})}`),
    };
  }

  private async resolveAnd(tenantId: string, orderNumber: string, fn: (orderId: string) => Promise<unknown>): Promise<unknown> {
    const res = await this.orders.getByNumber(tenantId, orderNumber);
    return fn(res.order.id);
  }
}
