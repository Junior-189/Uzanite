import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  MetaWebhookBody,
  MetaWebhookMessage,
  MetaWebhookStatus,
  extractInboundText,
  normalizeRecipient,
} from '@uzanite/messaging';
// (extractInboundText is used for the display text; interactive ids are read directly.)
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { newId } from '../../ids/id';
import { runAsSystem } from '../../context/tenant-context';

const STATUS_MAP: Record<string, 'sent' | 'delivered' | 'read' | 'failed'> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
};

export interface InboundDescriptor {
  tenantId: string;
  accountId: string;
  phone: string;
  text: string;
  messageType: string;
  providerMessageId: string;
  /** For interactive replies, the button/list row id (the flow command token). */
  interactiveId: string | null;
}

/**
 * Meta WhatsApp Cloud webhook ingestion.
 *
 * - GET verification uses META_VERIFY_TOKEN.
 * - POST bodies are authenticated with X-Hub-Signature-256 (META_APP_SECRET).
 * - Tenant routing: phone_number_id -> whatsapp_accounts.tenant_id.
 * - Each message/status is claimed in `webhook_events` (unique event_id) so Meta
 *   retries are idempotent; failures are surfaced so Meta retries the payload.
 * - No external calls here (all DB + outbox): outbound/read receipts are done by
 *   the worker, keeping the webhook fast and reliable.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService
  ) {}

  configured(): boolean {
    return !!(process.env.META_APP_SECRET && process.env.META_VERIFY_TOKEN);
  }

  verifyChallenge(mode?: string, token?: string, challenge?: string): { ok: boolean; challenge?: string } {
    const expected = process.env.META_VERIFY_TOKEN;
    if (!expected) return { ok: false };
    if (mode !== 'subscribe' || !token) return { ok: false };
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };
    return { ok: true, challenge };
  }

  verifySignature(rawBody: string | Buffer | undefined, header: string | undefined): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !rawBody || !header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handle(body: MetaWebhookBody): Promise<{ processed: number; failed: number; inbound: InboundDescriptor[] }> {
    if (body.object !== 'whatsapp_business_account') return { processed: 0, failed: 0, inbound: [] };

    return runAsSystem(() =>
      this.prisma.transaction(async () => {
        let processed = 0;
        let failed = 0;
        const inbound: InboundDescriptor[] = [];

        for (const entry of body.entry ?? []) {
          for (const change of entry.changes ?? []) {
            const value = change.value;
            const phoneNumberId = value?.metadata?.phone_number_id;
            if (!phoneNumberId) continue;

            const account = await this.prisma.db.whatsAppAccount.findFirst({ where: { phoneNumberId } });
            if (!account) {
              this.logger.warn(`Inbound webhook for unknown phone_number_id ${phoneNumberId} — ignoring`);
              continue;
            }
            const tenantId = account.tenantId;

            await this.prisma.db.whatsAppAccount.updateMany({
              where: { id: account.id },
              data: { lastInboundAt: new Date(), status: 'connected' },
            });

            for (const message of value.messages ?? []) {
              try {
                const descriptor = await this.handleInbound(tenantId, account.id, message);
                if (descriptor) {
                  processed++;
                  inbound.push(descriptor);
                }
              } catch (err) {
                failed++;
                this.logger.error(`Inbound message ${message.id} failed: ${(err as Error).message}`);
              }
            }
            for (const status of value.statuses ?? []) {
              try {
                if (await this.handleStatus(tenantId, status)) processed++;
              } catch (err) {
                failed++;
                this.logger.error(`Status ${status.id}:${status.status} failed: ${(err as Error).message}`);
              }
            }
          }
        }
        return { processed, failed, inbound };
      })
    );
  }

  /** Releases a dedupe claim so a failed flow can be re-driven on Meta retry. */
  async release(eventId: string): Promise<void> {
    try {
      await this.prisma.db.webhookEvent.deleteMany({ where: { provider: 'meta', eventId } });
    } catch {
      /* best-effort: a stale claim only delays reprocessing */
    }
  }

  private async claim(eventId: string, tenantId: string, type: string, payload: unknown): Promise<boolean> {
    const res = await this.prisma.db.webhookEvent.createMany({
      data: [{ id: newId(), provider: 'meta', eventId, tenantId, type, payload: payload as object }],
      skipDuplicates: true,
    });
    return res.count > 0;
  }

  private async handleInbound(tenantId: string, accountId: string, message: MetaWebhookMessage): Promise<InboundDescriptor | null> {
    if (!(await this.claim(`msg:${message.id}`, tenantId, 'message', message))) return null;

    const phone = normalizeRecipient(message.from);
    const text = extractInboundText(message).slice(0, 4000);
    const interactiveId = message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? null;
    const messageType = message.interactive ? 'interactive' : (message.type ?? 'text');

    const contact = await this.prisma.db.whatsAppContact.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: { lastMessageAt: new Date(), lastMessage: text.slice(0, 200), messageCount: { increment: 1 } },
      create: {
        id: newId(),
        tenantId,
        phone,
        jid: `${phone}@s.whatsapp.net`,
        messageCount: 1,
        lastMessageAt: new Date(),
        lastMessage: text.slice(0, 200),
      },
    });

    const mediaId =
      message.image?.id ?? message.document?.id ?? message.audio?.id ?? message.video?.id ?? null;
    const mediaMimeType =
      message.image?.mime_type ?? message.document?.mime_type ?? message.audio?.mime_type ?? message.video?.mime_type ?? null;

    const existingMessage = await this.prisma.db.message.findFirst({
      where: { tenantId, providerMessageId: message.id },
      select: { id: true },
    });
    if (!existingMessage) {
      await this.prisma.db.message.create({
      data: {
        id: newId(),
        tenantId,
        accountId,
        contactId: contact.id,
        direction: 'inbound',
        contactPhone: phone,
        messageType,
        text,
        mediaId,
        mediaMimeType,
        providerMessageId: message.id,
        status: 'received',
        raw: message as object,
        sentAt: new Date(),
        statusUpdatedAt: new Date(),
      },
      });
    }

    await this.outbox.enqueue({
      type: 'whatsapp.inbound',
      tenantId,
      payload: { messageId: message.id, contactPhone: phone, text, messageType, interactiveId },
    });
    await this.prisma.db.webhookEvent.updateMany({
      where: { eventId: `msg:${message.id}` },
      data: { processedAt: new Date() },
    });
    return {
      tenantId,
      accountId,
      phone,
      text,
      messageType,
      providerMessageId: message.id,
      interactiveId,
    };
  }

  private async handleStatus(tenantId: string, status: MetaWebhookStatus): Promise<boolean> {
    if (!(await this.claim(`status:${status.id}:${status.status}`, tenantId, 'status', status))) return false;

    const next = STATUS_MAP[status.status] ?? status.status;
    const error = status.errors?.[0];
    await this.prisma.db.message.updateMany({
      where: { tenantId, providerMessageId: status.id },
      data: {
        status: next as never,
        statusUpdatedAt: new Date(),
        errorCode: error?.code != null ? String(error.code) : null,
        errorMessage: error?.message ?? null,
      },
    });
    await this.prisma.db.webhookEvent.updateMany({
      where: { eventId: `status:${status.id}:${status.status}` },
      data: { processedAt: new Date() },
    });
    return true;
  }
}
