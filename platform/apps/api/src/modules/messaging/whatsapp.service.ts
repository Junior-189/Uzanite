import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InteractiveReply, MetaClient, normalizeRecipient } from '@uzanite/messaging';
import {
  ListConversationsQuery,
  ListMessagesQuery,
  SendMediaMessageInput,
  SendTemplateMessageInput,
  SendTextMessageInput,
  UpsertWhatsAppAccountInput,
  UpsertWhatsAppTemplateInput,
} from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { OutboxService } from '../../outbox/outbox.service';
import { QueueService } from '../../queue/queue.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { decryptPii } from '../../security/pii';
import { encrypt, tryDecrypt } from '../../crypto/crypto';

type AccountRow = {
  id: string;
  tenantId: string;
  provider: string;
  phoneNumberId: string | null;
  wabaId: string;
  displayPhoneNumber: string;
  accessTokenEnc: string;
  verifyTokenEnc: string;
  status: string;
  qualityRating: string;
  lastInboundAt: Date | null;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly outbox: OutboxService,
    private readonly queue: QueueService,
    private readonly meta: MetaClient
  ) {}

  // Secrets are write-only: never returned to clients.
  private publicAccount(account: AccountRow | null) {
    if (!account) return null;
    const { accessTokenEnc, verifyTokenEnc, ...rest } = account;
    return { ...rest, hasAccessToken: !!accessTokenEnc, hasVerifyToken: !!verifyTokenEnc };
  }

  // ── Accounts ─────────────────────────────────────────────────────────────────
  async getAccount(tenantId: string) {
    const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId } });
    return { success: true, account: this.publicAccount(account as AccountRow | null) };
  }

  async upsertAccount(tenantId: string, input: UpsertWhatsAppAccountInput) {
    const existing = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId } });
    const base = {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhoneNumber: input.displayPhoneNumber,
      status: 'pending' as const,
      lastError: '',
    };
    const secrets: Prisma.WhatsAppAccountUncheckedUpdateInput = {};
    if (input.accessToken !== undefined) secrets.accessTokenEnc = encrypt(input.accessToken);
    if (input.verifyToken !== undefined) secrets.verifyTokenEnc = encrypt(input.verifyToken);
    if (input.flowMode !== undefined) secrets.flowMode = input.flowMode;
    if (input.botPaused !== undefined) secrets.botPaused = input.botPaused;

    const account = existing
      ? await this.prisma.db.whatsAppAccount.update({ where: { id: existing.id }, data: { ...base, ...secrets } })
      : await this.prisma.db.whatsAppAccount.create({
          data: {
            id: newId(),
            tenantId,
            ...base,
            accessTokenEnc: input.accessToken ? encrypt(input.accessToken) : '',
            verifyTokenEnc: input.verifyToken ? encrypt(input.verifyToken) : '',
          },
        });
    return { success: true, account: this.publicAccount(account as AccountRow) };
  }

  /** Toggle the bot auto-reply pause flag (legacy `/whatsapp/pause|resume`). */
  async setBotPaused(tenantId: string, paused: boolean) {
    const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId } });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    await this.prisma.db.whatsAppAccount.update({ where: { id: account.id }, data: { botPaused: paused } });
    return { success: true, botPaused: paused };
  }

  async deleteAccount(tenantId: string) {
    const res = await this.prisma.db.whatsAppAccount.deleteMany({ where: { tenantId } });
    if (res.count === 0) throw new NotFoundException('WhatsApp account not found');
    return { success: true };
  }

  /** Resolve a tenant from an inbound Meta `phone_number_id` (system context). */
  async resolveByPhoneNumberId(phoneNumberId: string) {
    return this.uow.runAsSystem(() =>
      this.prisma.db.whatsAppAccount.findFirst({ where: { phoneNumberId } })
    );
  }

  async health(tenantId: string) {
    const account = (await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId } })) as AccountRow | null;
    const [queued, sent, failed] = await Promise.all([
      this.prisma.db.message.count({ where: { tenantId, direction: 'outbound', status: 'queued' } }),
      this.prisma.db.message.count({ where: { tenantId, direction: 'outbound', status: 'sent' } }),
      this.prisma.db.message.count({ where: { tenantId, direction: 'outbound', status: 'failed' } }),
    ]);
    return {
      success: true,
      configured: !!(account?.phoneNumberId && account.accessTokenEnc),
      status: account?.status ?? 'unconfigured',
      displayPhoneNumber: account?.displayPhoneNumber ?? '',
      qualityRating: account?.qualityRating ?? '',
      lastInboundAt: account?.lastInboundAt ?? null,
      lastError: account?.lastError ?? '',
      counts: { queued, sent, failed },
    };
  }

  // ── Templates ────────────────────────────────────────────────────────────────
  async listTemplates(tenantId: string) {
    const templates = await this.prisma.db.whatsAppTemplate.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return { success: true, count: templates.length, templates };
  }

  async upsertTemplate(tenantId: string, input: UpsertWhatsAppTemplateInput) {
    const template = await this.prisma.db.whatsAppTemplate.upsert({
      where: { tenantId_name_language: { tenantId, name: input.name, language: input.language } },
      update: { category: input.category, status: input.status, components: input.components as object },
      create: {
        id: newId(),
        tenantId,
        name: input.name,
        language: input.language,
        category: input.category,
        status: input.status,
        components: input.components as object,
      },
    });
    return { success: true, template };
  }

  async removeTemplate(tenantId: string, id: string) {
    const res = await this.prisma.db.whatsAppTemplate.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException('Template not found');
    return { success: true };
  }

  // ── Messages / conversations ─────────────────────────────────────────────────
  async listMessages(tenantId: string, query: ListMessagesQuery) {
    const where: Prisma.MessageWhereInput = { tenantId };
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;
    if (query.contactPhone) where.contactPhone = normalizeRecipient(query.contactPhone);
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.message.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, messages: page.items, nextCursor: page.nextCursor };
  }

  async listConversations(tenantId: string, query: ListConversationsQuery) {
    // Keyset pagination on (lastMessageAt DESC NULLS LAST, id DESC) — the cursor
    // MUST match the ordering column, unlike a plain id cursor.
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const where: Prisma.WhatsAppContactWhereInput = { tenantId, deletedAt: null };
    if (query.cursor) {
      const cursorRow = await this.prisma.db.whatsAppContact.findFirst({
        where: { id: query.cursor, tenantId },
        select: { id: true, lastMessageAt: true },
      });
      if (cursorRow) {
        const cursorLast = cursorRow.lastMessageAt;
        where.AND = [
          {
            OR: [
              ...(cursorLast ? [{ lastMessageAt: { lt: cursorLast } }] : []),
              { lastMessageAt: cursorLast, id: { lt: cursorRow.id } },
            ],
          },
        ];
      }
    }
    const rows = await this.prisma.db.whatsAppContact.findMany({
      where,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length ? page[page.length - 1].id : null;
    const items = page.map((c) => ({ ...c, name: decryptPii(c.name), phone: decryptPii(c.phone), email: decryptPii(c.email), lastMessage: decryptPii(c.lastMessage) }));
    return { success: true, count: items.length, conversations: items, nextCursor };
  }

  async getMessage(tenantId: string, id: string) {
    const message = await this.prisma.db.message.findFirst({ where: { id, tenantId } });
    if (!message) throw new NotFoundException('Message not found');
    return { success: true, message };
  }

  private async requireAccount(tenantId: string) {
    const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { tenantId } });
    if (!account) throw new BadRequestException('No WhatsApp account configured for this tenant');
    return account;
  }

  async enqueueText(tenantId: string, input: SendTextMessageInput, actor: string) {
    return this.enqueueOutbound(tenantId, 'text', input, actor);
  }

  async enqueueTemplate(tenantId: string, input: SendTemplateMessageInput, actor: string) {
    return this.enqueueOutbound(tenantId, 'template', input, actor);
  }

  async enqueueMedia(tenantId: string, input: SendMediaMessageInput, actor: string) {
    return this.enqueueOutbound(tenantId, 'media', input, actor);
  }

  /** Enqueue a native interactive reply (buttons/list) on the durable send path. */
  async enqueueInteractive(
    tenantId: string,
    input: { to: string; reply: InteractiveReply; idempotencyKey?: string | null },
    actor: string
  ) {
    const account = await this.requireAccount(tenantId);
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.prisma.db.message.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) return { success: true, message: existing, idempotent: true };
    }
    const message = await this.prisma.db.message.create({
      data: {
        id: newId(),
        tenantId,
        accountId: account.id,
        direction: 'outbound',
        contactPhone: normalizeRecipient(input.to),
        messageType: 'interactive',
        status: 'queued',
        idempotencyKey,
        raw: input.reply as unknown as object,
      },
    });
    await this.queue.add('whatsapp-outbound', 'send', { messageId: message.id }).catch(() => undefined);
    await this.outbox.enqueue({
      type: 'whatsapp.queued',
      tenantId,
      payload: { messageId: message.id, kind: 'interactive', to: message.contactPhone, by: actor },
    });
    return { success: true, message, idempotent: false };
  }

  private async enqueueOutbound(
    tenantId: string,
    kind: 'text' | 'template' | 'media',
    input: { to: string; idempotencyKey?: string | null } & Record<string, unknown>,
    actor: string
  ) {
    const account = await this.requireAccount(tenantId);
    const idempotencyKey = input.idempotencyKey?.trim() || null;

    if (idempotencyKey) {
      const existing = await this.prisma.db.message.findFirst({ where: { tenantId, idempotencyKey } });
      if (existing) return { success: true, message: existing, idempotent: true };
    }

    const raw =
      kind === 'template'
        ? { language: input.language ?? 'en_US', components: input.components ?? [] }
        : kind === 'media'
          ? { type: input.type ?? 'image', link: input.link ?? null, caption: input.caption ?? null, filename: input.filename ?? null }
          : {};

    const message = await this.prisma.db.message.create({
      data: {
        id: newId(),
        tenantId,
        accountId: account.id,
        direction: 'outbound',
        contactPhone: normalizeRecipient(input.to),
        messageType: kind,
        text: kind === 'text' ? String(input.text ?? '') : '',
        templateName: kind === 'template' ? String(input.templateName ?? '') : null,
        mediaId: kind === 'media' ? ((input.mediaId as string | undefined) ?? null) : null,
        status: 'queued',
        idempotencyKey,
        raw: raw as object,
      },
    });

    // Wake the worker immediately when Redis is available (the DB queue is the
    // source of truth; the worker's poller is the reliability net).
    await this.queue.add('whatsapp-outbound', 'send', { messageId: message.id }).catch(() => undefined);
    await this.outbox.enqueue({
      type: 'whatsapp.queued',
      tenantId,
      payload: { messageId: message.id, kind, to: message.contactPhone, by: actor },
    });

    return { success: true, message, idempotent: false };
  }

  // This handler opts out of the request-wide RLS transaction
  // (`@NoRequestTransaction`): it reads in a short tenant transaction, then
  // calls Meta with NO transaction held.
  async markRead(tenantId: string, messageId: string) {
    const ctx = await this.prisma.withTenant(tenantId, async () => {
      const message = await this.prisma.db.message.findFirst({ where: { id: messageId, tenantId } });
      if (!message) throw new NotFoundException('Message not found');
      const account = await this.requireAccount(tenantId);
      return { message, account };
    });

    if (!ctx.account.phoneNumberId || !ctx.account.accessTokenEnc) {
      throw new BadRequestException('WhatsApp account is missing phone_number_id or access token');
    }
    // A key mismatch is an operator problem, not a client problem: say so
    // clearly in the logs instead of surfacing it as a generic send failure.
    const { value: accessToken, error: decryptError } = tryDecrypt(ctx.account.accessTokenEnc);
    if (decryptError || !accessToken) {
      this.logger.error(
        `Cannot decrypt the WhatsApp access token for tenant ${tenantId} (${decryptError?.reason ?? 'empty'}). ` +
          'Check that ENCRYPTION_KEY matches the key used when the token was saved.'
      );
      throw new BadRequestException('WhatsApp credentials are unavailable. Contact support.');
    }

    try {
      await this.meta.markRead(
        { phoneNumberId: ctx.account.phoneNumberId, accessToken },
        ctx.message.providerMessageId ?? ctx.message.id
      );
      return { success: true };
    } catch (err) {
      // Do not leak the provider's raw error to the client.
      this.logger.error(`WhatsApp markRead failed for ${messageId}: ${(err as Error).message}`);
      throw new BadRequestException('Unable to mark the message as read');
    }
  }
}
