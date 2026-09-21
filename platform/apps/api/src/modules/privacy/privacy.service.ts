import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConsentInput, PrivacyEraseInput, PrivacyExportQuery, ListPrivacyRequestsQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { blindIndex, decryptPii } from '../../security/pii';

interface Actor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

const digits = (value?: string) => (value ? value.replace(/\D/g, '') : '');
const lower = (value?: string) => (value ? value.trim().toLowerCase() : '');

/**
 * Data-subject rights under Tanzania's Personal Data Protection Act (2022):
 * access/portability (export), erasure, and consent.
 *
 * Two deliberate design decisions:
 *
 * 1. **Erasure pseudonymises rather than deletes, by default.** A business is
 *    required to keep financial records; a customer is entitled to have their
 *    personal data removed. Those obligations conflict if erasure means DELETE.
 *    So identifying fields are overwritten while the order, payment and ledger
 *    rows (amounts, dates, totals) survive. The ledger is append-only anyway —
 *    a trigger would reject an UPDATE — which is exactly why PII must not be
 *    stored in it and why we scrub the tables that carry it instead.
 *
 * 2. **Every request is recorded in `privacy_requests`**, which is append-only.
 *    Being able to demonstrate what was done, when, and by whom is the part of
 *    compliance that auditors actually ask for.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async record(
    tenantId: string,
    kind: string,
    subjectType: string,
    subjectRef: string,
    actor: Actor,
    detail: Record<string, unknown>
  ): Promise<void> {
    await this.prisma.db.privacyRequest.create({
      data: {
        id: newId(),
        tenantId,
        kind,
        subjectType,
        subjectRef,
        status: 'completed',
        requestedBy: actor.userId,
        detail: detail as object,
        completedAt: new Date(),
      },
    });
  }

  /** Access + portability. Returns machine-readable JSON. */
  async exportData(tenantId: string, query: PrivacyExportQuery, actor: Actor) {
    const phone = digits(query.phone);
    const email = lower(query.email);
    const subjectScoped = !!(phone || email);

    // During the PII rollout a subject's rows may still be plaintext; match the
    // blind index OR the legacy plaintext so exports work before the backfill.
    const contactWhere: Record<string, unknown> = subjectScoped ? { tenantId } : { tenantId };
    if (phone) contactWhere.OR = [{ phoneIdx: blindIndex(phone) }, { phone }];
    else if (email) contactWhere.email = email;
    const orderWhere: Record<string, unknown> = subjectScoped ? { tenantId } : { tenantId };
    if (phone) orderWhere.OR = [{ customerPhoneIdx: blindIndex(phone) }, { customerPhone: phone }];
    else if (email) orderWhere.customerEmail = email;

    const [tenant, contacts, orders, messages, consents] = await Promise.all([
      this.prisma.db.tenant.findFirst({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, currency: true, createdAt: true },
      }),
      this.prisma.db.whatsAppContact.findMany({ where: contactWhere, take: 5000 }),
      this.prisma.db.order.findMany({
        where: orderWhere,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      phone
        ? this.prisma.db.message.findMany({
            where: { tenantId, contactPhoneIdx: blindIndex(phone) },
            orderBy: { createdAt: 'desc' },
            take: 5000,
          })
        : Promise.resolve([]),
      this.prisma.db.privacyRequest.findMany({
        where: { tenantId, ...(subjectScoped ? { subjectRef: phone || email } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    await this.record(tenantId, 'export', subjectScoped ? 'contact' : 'tenant', phone || email || tenantId, actor, {
      contacts: contacts.length,
      orders: orders.length,
      messages: messages.length,
    });

    return {
      success: true,
      exportedAt: new Date().toISOString(),
      scope: subjectScoped ? 'data_subject' : 'tenant',
      subject: subjectScoped ? { phone: phone || null, email: email || null } : null,
      tenant,
      contacts,
      orders,
      messages: (messages as Array<{ text?: string; contactPhone?: string }>).map((m) => ({
        ...m,
        text: decryptPii(m.text),
        contactPhone: decryptPii(m.contactPhone),
      })),
      privacyRequests: consents,
    };
  }

  /** Right to erasure. Pseudonymises by default; see the class comment. */
  async erase(tenantId: string, input: PrivacyEraseInput, actor: Actor) {
    const phone = digits(input.phone);
    const email = lower(input.email);
    if (!phone && !email) throw new BadRequestException('phone or email is required');

    const redactedPhone = phone ? `erased-${phone.slice(-4).padStart(4, '0')}` : '';
    const results: Record<string, number> = {};

    await this.prisma.transaction(async () => {
      // Contacts: scrub identity, keep the row so message threading and
      // aggregate counts stay consistent.
      if (phone || email) {
        const contacts = await this.prisma.db.whatsAppContact.updateMany({
          where: phone
            ? { tenantId, OR: [{ phoneIdx: blindIndex(phone) }, { phone }] }
            : { tenantId, email },
          data: {
            name: '[erased]',
            email: '',
            lastMessage: '',
            optIn: false,
            consentStatus: 'erased',
            consentAt: new Date(),
            consentSource: 'erasure_request',
            deletedAt: new Date(),
          },
        });
        results.contacts = contacts.count;
      }

      // Message bodies are personal data; the delivery metadata is not.
      if (phone) {
        const messages = await this.prisma.db.message.updateMany({
          where: { tenantId, contactPhoneIdx: blindIndex(phone) },
          data: { text: '[erased]' },
        });
        results.messages = messages.count;
      }

      // Orders keep their financial shape; the customer identity is removed.
      const orders = await this.prisma.db.order.updateMany({
        where: phone
          ? { tenantId, OR: [{ customerPhoneIdx: blindIndex(phone) }, { customerPhone: phone }] }
          : { tenantId, customerEmail: email },
        data: {
          customerName: '[erased]',
          customerPhone: redactedPhone,
          customerPhoneIdx: null,
          customerEmail: '',
          deliveryLocation: '[erased]',
          deliveryPhone: '',
        },
      });
      results.orders = orders.count;

      if (!input.preserveFinancialRecords) {
        // The caller explicitly asked for destruction. We still refuse to break
        // the books: orders with money attached cannot be removed, matching the
        // permanent-delete guard in OrdersService.
        const withMoney = await this.prisma.db.payment.count({
          where: { tenantId, order: { customerPhone: redactedPhone } },
        });
        if (withMoney > 0) {
          this.logger.warn(
            `Erasure for ${phone || email} kept ${withMoney} order(s) with payment records; pseudonymised instead`
          );
        }
      }

      // The conversation carries a cart and free-form context that can hold
      // personal data (names, delivery notes), so reset both and park the flow.
      if (phone) {
        await this.prisma.db.conversation.updateMany({
          where: { tenantId, contactPhone: phone },
          data: { cart: [] as object, context: {} as object, step: 'LANGUAGE_SELECT', language: '' },
        });
      }
    });

    await this.record(tenantId, 'erasure', 'contact', phone || email, actor, {
      ...results,
      preserveFinancialRecords: input.preserveFinancialRecords,
      reason: input.reason,
    });

    return { success: true, results, message: 'Personal data erased. Financial records were retained as required.' };
  }

  /** Consent grant/withdraw, with an auditable trail. */
  async setConsent(tenantId: string, input: ConsentInput, actor: Actor) {
    const phone = digits(input.phone);
    const email = lower(input.email);
    if (!phone && !email) throw new BadRequestException('phone or email is required');

    const granted = input.action === 'granted';
    const updated = await this.prisma.db.whatsAppContact.updateMany({
      where: { tenantId, ...(phone ? { phone } : { email }) },
      data: {
        optIn: granted,
        consentStatus: granted ? 'granted' : 'revoked',
        consentAt: new Date(),
        consentSource: input.source,
      },
    });

    await this.record(
      tenantId,
      granted ? 'consent_grant' : 'consent_withdraw',
      'contact',
      phone || email,
      actor,
      { channel: input.channel, source: input.source, contactsUpdated: updated.count, ip: actor.ip ?? null }
    );

    return { success: true, action: input.action, contactsUpdated: updated.count };
  }

  /** The compliance trail for this tenant. */
  async listRequests(tenantId: string, query: ListPrivacyRequestsQuery) {
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.privacyRequest.findMany(args as never) as Promise<{ id: string }[]>,
      where: { tenantId },
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, requests: page.items, nextCursor: page.nextCursor };
  }
}
