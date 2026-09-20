import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ContactEmailInput, CreateContactInput, ListContactsQuery, UpdateContactInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';

// Contacts are stored on the tenant-scoped WhatsAppContact model (the same row
// the messaging pipeline upserts). This service exposes the legacy-compatible
// `/contacts` API: phone-keyed CRUD, soft delete/restore, chat history, email.
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService
  ) {}

  private normalize(phone: string): string {
    return String(phone ?? '').replace(/[^\d]/g, '');
  }

  // Adds the `_id` alias the client keys rows on.
  private serialize<T extends { id: string }>(row: T): T & { _id: string } {
    return { ...row, _id: row.id };
  }

  async list(tenantId: string, query: ListContactsQuery) {
    const where: Prisma.WhatsAppContactWhereInput = { tenantId, deletedAt: null };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.whatsAppContact.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, contacts: page.items.map((c) => this.serialize(c)), nextCursor: page.nextCursor };
  }

  async add(tenantId: string, input: CreateContactInput) {
    const phone = this.normalize(input.phone);
    if (phone.length < 5) throw new BadRequestException('Invalid phone number');

    const existing = await this.prisma.db.whatsAppContact.findFirst({ where: { tenantId, phone } });
    if (existing) return { success: true, contact: this.serialize(existing), message: 'Contact already exists' };

    const contact = await this.prisma.db.whatsAppContact.create({
      data: {
        id: newId(),
        tenantId,
        phone,
        jid: `${phone}@s.whatsapp.net`,
        name: input.name ?? '',
        messageCount: 0,
        lastMessageAt: new Date(),
        lastMessage: '[Manually added]',
      },
    });
    return { success: true, contact: this.serialize(contact), message: 'Contact added successfully' };
  }

  private async findOrThrow(tenantId: string, phoneRaw: string) {
    const phone = this.normalize(phoneRaw);
    const contact = await this.prisma.db.whatsAppContact.findFirst({ where: { tenantId, phone } });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async update(tenantId: string, phoneRaw: string, input: UpdateContactInput) {
    const contact = await this.findOrThrow(tenantId, phoneRaw);
    const data: Prisma.WhatsAppContactUpdateInput = {};
    if (typeof input.name === 'string') data.name = input.name.trim();
    if (typeof input.email === 'string') data.email = input.email.trim().toLowerCase();
    const updated = await this.prisma.db.whatsAppContact.update({ where: { id: contact.id }, data });
    return { success: true, contact: this.serialize(updated), message: 'Contact updated' };
  }

  async remove(tenantId: string, phoneRaw: string, userId: string, permanent = false) {
    const contact = await this.findOrThrow(tenantId, phoneRaw);
    if (permanent) {
      await this.prisma.db.whatsAppContact.deleteMany({ where: { id: contact.id, tenantId } });
      return { success: true, message: 'Contact permanently deleted' };
    }
    await this.prisma.db.whatsAppContact.updateMany({
      where: { id: contact.id, tenantId },
      data: { deletedAt: new Date(), deletedBy: userId ?? null },
    });
    return { success: true, message: 'Contact moved to recycle bin' };
  }

  async restore(tenantId: string, phoneRaw: string) {
    const phone = this.normalize(phoneRaw);
    const res = await this.prisma.db.whatsAppContact.updateMany({
      where: { tenantId, phone, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null },
    });
    if (res.count === 0) throw new NotFoundException('Contact not found in recycle bin');
    return { success: true, message: 'Contact restored' };
  }

  // ID-based variants used by the aggregated recycle bin.
  async restoreById(tenantId: string, id: string) {
    const res = await this.prisma.db.whatsAppContact.updateMany({
      where: { tenantId, id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null },
    });
    if (res.count === 0) throw new NotFoundException('Contact not found in recycle bin');
    return { success: true, message: 'Contact restored' };
  }

  async removeById(tenantId: string, id: string, userId: string, permanent = false) {
    const contact = await this.prisma.db.whatsAppContact.findFirst({ where: { tenantId, id } });
    if (!contact) throw new NotFoundException('Contact not found');
    if (permanent) {
      await this.prisma.db.whatsAppContact.deleteMany({ where: { id, tenantId } });
      return { success: true, message: 'Contact permanently deleted' };
    }
    await this.prisma.db.whatsAppContact.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date(), deletedBy: userId ?? null },
    });
    return { success: true, message: 'Contact moved to recycle bin' };
  }

  async messages(tenantId: string, phoneRaw: string, limit = 50) {
    const phone = this.normalize(phoneRaw);
    // Access check: the contact must belong to this tenant.
    await this.findOrThrow(tenantId, phone);
    const rows = await this.prisma.db.message.findMany({
      where: { tenantId, contactPhone: phone },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const messages = rows.reverse().map((m) => ({ ...m, _id: m.id }));
    return { success: true, count: messages.length, messages };
  }

  async sendEmail(tenantId: string, phoneRaw: string, input: ContactEmailInput) {
    const contact = await this.findOrThrow(tenantId, phoneRaw);
    if (!contact.email) throw new BadRequestException('This contact has no email address');

    const escapeHtml = (v: string) =>
      String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const from = this.config.get<string>('EMAIL_FROM') ?? 'UZANITE <no-reply@uzanite.local>';

    await this.outbox.enqueue({
      type: 'email.send',
      tenantId,
      payload: {
        to: contact.email,
        subject: input.subject,
        html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;">${escapeHtml(input.message).replace(/\n/g, '<br/>')}</div>`,
        from,
      },
    });
    return { success: true, message: `Email queued for ${contact.email}`, sentAt: new Date() };
  }
}
