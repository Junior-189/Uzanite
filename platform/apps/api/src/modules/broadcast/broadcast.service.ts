import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { BroadcastContactInput, BroadcastImportInput, BroadcastSendInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppService } from '../messaging/whatsapp.service';
import { OutboxService } from '../../outbox/outbox.service';
import { BillingService } from '../billing/billing.service';
import { newId } from '../../ids/id';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ImportEntry {
  email: string;
  name: string;
}

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly outbox: OutboxService,
    private readonly billing: BillingService
  ) {}

  async send(tenantId: string, input: BroadcastSendInput, actor: string) {
    const channel = input.channel ?? 'whatsapp';
    const wantWhatsapp = channel === 'whatsapp' || channel === 'both';
    const wantEmail = channel === 'email' || channel === 'both';

    const contacts = await this.prisma.db.whatsAppContact.findMany({
      where: { tenantId, deletedAt: null, optIn: true, unsubscribedAt: null },
    });
    if (contacts.length === 0) {
      throw new BadRequestException(
        'No opted-in contacts to broadcast to. Contacts must have messaged you and not replied STOP.'
      );
    }

    const emailContacts = wantEmail ? contacts.filter((c) => c.email && c.email.trim()) : [];
    if (wantEmail && emailContacts.length === 0) {
      throw new BadRequestException('None of the opted-in contacts have an email address on file.');
    }
    if (wantWhatsapp) {
      const health = await this.whatsapp.health(tenantId);
      if (!health.configured) throw new BadRequestException('WhatsApp is not connected. Add Meta credentials first.');
    }

    const total = (wantWhatsapp ? contacts.length : 0) + emailContacts.length;

    if (wantEmail) {
      await this.prisma.db.broadcastLog.create({
        data: {
          id: newId(),
          tenantId,
          subject: (input.subject ?? '').slice(0, 200),
          body: input.message,
          recipients: emailContacts.map((c) => c.email),
          count: emailContacts.length,
          channel: channel === 'both' ? 'both' : 'email',
        },
      });
    }

    const optOut = '\n\nReply STOP to unsubscribe.';
    if (wantWhatsapp) {
      for (const contact of contacts) {
        await this.whatsapp
          .enqueueText(tenantId, { to: contact.phone, text: `${input.message}${optOut}` }, actor)
          .catch(() => undefined);
      }
    }
    for (const contact of emailContacts) {
      await this.outbox.enqueue({
        type: 'email.send',
        tenantId,
        payload: {
          to: contact.email,
          subject: input.subject || 'Broadcast',
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${input.message}${optOut}</div>`,
        },
      });
    }

    await this.billing.incrementUsage(tenantId, 'broadcastsPerMonth', 1);

    return {
      success: true,
      accepted: true,
      channel,
      total,
      whatsappCount: wantWhatsapp ? contacts.length : 0,
      emailCount: emailContacts.length,
      message: `Broadcast started via ${channel} to ${total} recipient(s). You'll be notified when it completes.`,
    };
  }

  async sent(tenantId: string) {
    const rows = await this.prisma.db.broadcastLog.findMany({ where: { tenantId }, orderBy: { sentAt: 'desc' }, take: 100 });
    return { success: true, logs: rows.map((r) => ({ ...r, _id: r.id })) };
  }

  async contacts(tenantId: string) {
    const rows = await this.prisma.db.whatsAppContact.findMany({
      where: { tenantId, deletedAt: null, email: { not: '' } },
      orderBy: { lastMessageAt: 'desc' },
    });
    return {
      success: true,
      contacts: rows.map((c) => ({ _id: c.id, id: c.id, name: c.name, email: c.email, phone: c.phone, lastMessageAt: c.lastMessageAt })),
    };
  }

  async contactsCount(tenantId: string) {
    const count = await this.prisma.db.whatsAppContact.count({ where: { tenantId, deletedAt: null } });
    return { success: true, count };
  }

  async addContact(tenantId: string, input: BroadcastContactInput) {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new BadRequestException('A valid email is required');
    // Placeholder phone keeps the (tenantId, phone) uniqueness satisfied.
    const phone = `email::${email}`;
    const existing = await this.prisma.db.whatsAppContact.findFirst({ where: { tenantId, phone } });
    if (existing) throw new ConflictException('This email is already in your contacts');

    const contact = await this.prisma.db.whatsAppContact.create({
      data: { id: newId(), tenantId, phone, email, name: input.name ?? '', optIn: true, lastMessageAt: new Date() },
    });
    return { success: true, contact: { ...contact, _id: contact.id } };
  }

  async importEmails(tenantId: string, input: BroadcastImportInput) {
    const entries = this.parseImport(input.data);
    const valid = entries.filter((e) => EMAIL_RE.test(e.email));
    const invalid = entries.length - valid.length;
    if (valid.length === 0) throw new BadRequestException('No valid email addresses found');

    const seen = new Set<string>();
    const unique = valid.filter((e) => {
      const key = e.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let inserted = 0;
    let updated = 0;
    for (const entry of unique) {
      const email = entry.email.toLowerCase();
      const phone = `email::${email}`;
      const existing = await this.prisma.db.whatsAppContact.findFirst({ where: { tenantId, phone } });
      if (existing) {
        const data: { name?: string } = {};
        if (!existing.name && entry.name) data.name = entry.name;
        if (Object.keys(data).length) {
          await this.prisma.db.whatsAppContact.update({ where: { id: existing.id }, data });
          updated++;
        }
        continue;
      }
      await this.prisma.db.whatsAppContact.create({
        data: { id: newId(), tenantId, phone, email, name: entry.name, optIn: false, consentStatus: 'pending', lastMessageAt: new Date() },
      });
      inserted++;
    }

    return { success: true, inserted, updated, invalid, message: `Imported ${inserted} contact(s), updated ${updated}.` };
  }

  private parseImport(data: BroadcastImportInput['data']): ImportEntry[] {
    const entries: ImportEntry[] = [];
    const push = (e: unknown) => {
      if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        entries.push({
          email: String(o.email ?? o.Email ?? o.EMAIL ?? '').trim(),
          name: String(o.name ?? o.Name ?? o.NAME ?? '').trim(),
        });
      } else {
        entries.push({ email: String(e ?? '').trim(), name: '' });
      }
    };

    if (Array.isArray(data)) {
      data.forEach(push);
      return entries;
    }
    if (typeof data === 'object' && data !== null) {
      push(data);
      return entries;
    }

    const text = String(data ?? '').trim();
    if (!text) throw new BadRequestException('No data provided');
    if (text.startsWith('[') || text.startsWith('{')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new BadRequestException('Invalid JSON format');
      }
      (Array.isArray(parsed) ? parsed : [parsed]).forEach(push);
      return entries;
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const emailIdx = header.indexOf('email');
    const nameIdx = header.indexOf('name');
    const start = emailIdx !== -1 ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      entries.push({
        email: (emailIdx !== -1 ? cols[emailIdx] : cols[0]) || '',
        name: (nameIdx !== -1 ? cols[nameIdx] : cols[1]) || '',
      });
    }
    return entries;
  }
}
