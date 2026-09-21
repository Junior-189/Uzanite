import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InteractiveReply, MetaApiError, MetaClient, normalizeRecipient, tryDecrypt } from '@uzanite/messaging';
import { randomUUID } from 'crypto';

const POLL_MS = 10000;
const BATCH = 20;
const MAX_ATTEMPTS = 5;
// A `sending` row older than this was claimed by a crashed worker; reclaim it.
const LEASE_MS = 10 * 60 * 1000;

type MessageRow = Prisma.MessageGetPayload<{ include: { account: true } }>;
type SendOutcome = { status: string; error?: string };

/**
 * Durable outbound WhatsApp sender. Outbound rows in `messages` (status
 * `queued`) are the queue; this worker claims them atomically, calls the Meta
 * Cloud API, and records `sent`/`failed` with retry/backoff.
 *
 * Network I/O is deliberately performed OUTSIDE any database transaction:
 *   1. short tx: read the message + account (bypass RLS)
 *   2. no tx:    decrypt + call the Meta API
 *   3. short tx: persist the result / schedule a retry
 * This keeps DB connections and row locks from being held for the duration of a
 * remote call, which is critical under load.
 */
@Injectable()
export class WhatsAppOutboundService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WhatsAppOutboundService.name);
  private readonly prisma = new PrismaClient();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly meta: MetaClient) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.$connect();
    this.timer = setInterval(() => this.tick().catch((e) => this.logger.error(e.message)), POLL_MS);
    this.logger.log('WhatsApp outbound sender started');
  }

  /** Runs one poll cycle immediately (tests / manual drains). */
  async drainOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Reclaim rows stranded in `sending` by a crashed worker (lease expiry).
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.message.updateMany({
          where: { direction: 'outbound', status: 'sending', updatedAt: { lt: new Date(Date.now() - LEASE_MS) } },
          data: { status: 'queued' },
        });
      });

      // Claim a batch atomically (no network I/O inside this transaction).
      const ids = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        const rows = await tx.message.findMany({
          where: { direction: 'outbound', status: 'queued', availableAt: { lte: new Date() } },
          orderBy: { createdAt: 'asc' },
          take: BATCH,
          select: { id: true },
        });
        const claimed: string[] = [];
        for (const row of rows) {
          const res = await tx.message.updateMany({ where: { id: row.id, status: 'queued' }, data: { status: 'sending' } });
          if (res.count > 0) claimed.push(row.id);
        }
        return claimed;
      });
      for (const id of ids) await this.sendOne(id);
    } finally {
      this.running = false;
    }
  }

  /** Insert a queued outbound message inside the caller's transaction (idempotent). */
  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      to: string;
      text?: string;
      templateName?: string;
      messageType?: string;
      idempotencyKey?: string | null;
      raw?: Record<string, unknown>;
    }
  ): Promise<string | null> {
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    if (idempotencyKey) {
      const existing = await tx.message.findFirst({ where: { tenantId: input.tenantId, idempotencyKey } });
      if (existing) return existing.id;
    }
    const id = randomUUID();
    const res = await tx.message.createMany({
      data: [
        {
          id,
          tenantId: input.tenantId,
          direction: 'outbound',
          contactPhone: normalizeRecipient(input.to),
          messageType: input.messageType ?? (input.templateName ? 'template' : 'text'),
          text: input.text ?? '',
          templateName: input.templateName ?? null,
          status: 'queued',
          idempotencyKey,
          raw: (input.raw ?? {}) as object,
        },
      ],
      skipDuplicates: true,
    });
    return res.count > 0 ? id : null;
  }

  async sendOne(id: string): Promise<SendOutcome> {
    // ── Step 1: load the row + account in a short transaction (no I/O). ────────
    const loaded = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const message = await tx.message.findUnique({ where: { id }, include: { account: true } });
      if (!message || message.direction !== 'outbound') return { kind: 'skip' as const, status: 'skipped' };
      if (!['queued', 'sending'].includes(message.status)) return { kind: 'skip' as const, status: message.status };
      let account = message.account;
      if (!account) account = await tx.whatsAppAccount.findFirst({ where: { tenantId: message.tenantId } });
      return { kind: 'ok' as const, message, account };
    });

    if (loaded.kind === 'skip') return { status: loaded.status };
    const { message, account } = loaded;

    if (!account?.phoneNumberId || !account.accessTokenEnc) {
      await this.fail(message, 'No WhatsApp account configured', null, true);
      return { status: 'failed', error: 'no account' };
    }

    // Fail the message permanently and loudly on a key mismatch: retrying with
    // the wrong ENCRYPTION_KEY can never succeed, and silently returning an
    // empty token would look like "Meta rejected us".
    const { value: accessToken, error: decryptError } = tryDecrypt(account.accessTokenEnc);
    if (decryptError || !accessToken) {
      const reason = `Cannot decrypt WhatsApp access token (${decryptError?.reason ?? 'empty'}) — check ENCRYPTION_KEY`;
      this.logger.error(`${reason} [tenant=${message.tenantId}]`);
      await this.fail(message, reason, null, true);
      return { status: 'failed', error: 'credentials' };
    }

    const creds = { phoneNumberId: account.phoneNumberId, accessToken };
    const raw = (message.raw ?? {}) as {
      language?: string;
      components?: unknown[];
      type?: string;
      link?: string;
      caption?: string;
      filename?: string;
      kind?: string;
    };

    // ── Step 2: network I/O — NO database transaction is held here. ───────────
    try {
      let result;
      if (message.messageType === 'interactive') {
        result = await this.meta.sendInteractive(creds, message.contactPhone, raw as unknown as InteractiveReply);
      } else if (message.templateName) {
        result = await this.meta.sendTemplate(creds, message.contactPhone, {
          name: message.templateName,
          language: raw.language,
          components: raw.components,
        });
      } else if (message.messageType !== 'text') {
        result = await this.meta.sendMedia(creds, message.contactPhone, {
          type: (raw.type as 'image' | 'document' | 'audio' | 'video' | undefined) ?? 'image',
          link: raw.link,
          id: message.mediaId ?? undefined,
          caption: raw.caption,
          filename: raw.filename,
        });
      } else {
        result = await this.meta.sendText(creds, message.contactPhone, message.text);
      }

      // ── Step 3: persist the outcome in a short transaction. ────────────────
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.message.update({
          where: { id },
          data: {
            status: 'sent',
            providerMessageId: result.messageId,
            sentAt: new Date(),
            statusUpdatedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            raw: result.raw as object,
          },
        });
        await tx.whatsAppAccount.update({ where: { id: account.id }, data: { status: 'connected', lastError: '' } });
      });
      this.logger.log(`Sent WhatsApp message ${id} -> ${message.contactPhone}`);
      return { status: 'sent' };
    } catch (err) {
      const permanent = err instanceof MetaApiError ? err.permanent : false;
      const status = err instanceof MetaApiError ? err.status : undefined;
      await this.fail(message, (err as Error).message, status ?? null, permanent);
      const willRetry = !permanent && message.attempts + 1 < MAX_ATTEMPTS;
      return { status: willRetry ? 'queued' : 'failed', error: (err as Error).message };
    }
  }

  private async fail(
    message: MessageRow,
    errorMessage: string,
    status: number | null,
    permanent: boolean
  ): Promise<void> {
    const attempts = message.attempts + 1;
    const failed = permanent || attempts >= MAX_ATTEMPTS;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.message.update({
        where: { id: message.id },
        data: {
          status: failed ? 'failed' : 'queued',
          attempts,
          errorMessage,
          errorCode: status != null ? String(status) : null,
          statusUpdatedAt: new Date(),
          availableAt: new Date(Date.now() + Math.min(2 ** attempts * 1000, 60000)),
        },
      });
      if (failed && message.accountId) {
        await tx.whatsAppAccount.updateMany({
          where: { id: message.accountId },
          data: { status: 'error', lastError: errorMessage },
        });
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.prisma.$disconnect();
  }
}
