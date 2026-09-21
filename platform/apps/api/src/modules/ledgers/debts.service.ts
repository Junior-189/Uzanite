import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DebtCreateInput, DebtPayInput, DebtUpdateInput, ListDebtsQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { actorOf, num, periodStart } from './ledger-utils';
import { Principal } from '../../context/tenant-context';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DebtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService
  ) {}

  private serialize(row: { id: string; amount: unknown; paidAmount: unknown }) {
    const amount = num(row.amount);
    const paidAmount = num(row.paidAmount);
    return { ...row, _id: row.id, amount, paidAmount, remaining: round2(Math.max(0, amount - paidAmount)) };
  }

  async list(tenantId: string, query: ListDebtsQuery) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.search) {
      where.OR = [
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { customerPhone: { contains: query.search } },
      ];
    }
    const from = periodStart(query.period);
    if (from) where.createdAt = { gte: from };

    const page = await paginate<{ id: string; amount: unknown; paidAmount: unknown }>({
      findMany: (args) =>
        this.prisma.db.debt.findMany(args as never) as Promise<{ id: string; amount: unknown; paidAmount: unknown }[]>,
      where,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const debts = page.items.map((d) => this.serialize(d));
    const totalDebt = debts.reduce((sum, d) => sum + d.amount, 0);
    const totalUnpaid = debts.reduce((sum, d) => sum + d.remaining, 0);
    return { success: true, debts, totalUnpaid, totalDebt, count: debts.length, nextCursor: page.nextCursor };
  }

  async create(tenantId: string, input: DebtCreateInput, principal: Principal) {
    const clientRef = input.clientRef?.trim() ? input.clientRef.trim() : null;
    if (clientRef) {
      const existing = await this.prisma.db.debt.findFirst({ where: { tenantId, clientRef } });
      if (existing) return { success: true, debt: this.serialize(existing) };
    }
    try {
      const debt = await this.prisma.db.debt.create({
        data: {
          id: newId(),
          tenantId,
          customerName: input.customerName,
          customerPhone: input.customerPhone ?? '',
          amount: String(round2(input.amount)),
          description: input.description ?? '',
          dueDate: input.dueDate ?? null,
          orderId: input.orderId ? input.orderId : null,
          notes: input.notes ?? '',
          recordedBy: actorOf(principal),
          clientRef,
        },
      });
      return { success: true, debt: this.serialize(debt) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && clientRef) {
        const existing = await this.prisma.db.debt.findFirst({ where: { tenantId, clientRef } });
        if (existing) return { success: true, debt: this.serialize(existing) };
      }
      throw err;
    }
  }

  private async getOrThrow(tenantId: string, id: string) {
    const debt = await this.prisma.db.debt.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!debt) throw new NotFoundException('Debt not found');
    return debt;
  }

  async update(tenantId: string, id: string, input: DebtUpdateInput) {
    await this.getOrThrow(tenantId, id);
    const data: Record<string, unknown> = {};
    if (input.customerName !== undefined) data.customerName = input.customerName;
    if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone;
    if (input.amount !== undefined) data.amount = String(round2(input.amount));
    if (input.description !== undefined) data.description = input.description;
    if (input.dueDate !== undefined) data.dueDate = input.dueDate;
    if (input.notes !== undefined) data.notes = input.notes;
    if (Object.keys(data).length === 0) throw new BadRequestException('No updatable fields provided');

    const debt = await this.prisma.db.debt.update({ where: { id }, data });
    return { success: true, debt: this.serialize(debt) };
  }

  async pay(tenantId: string, id: string, input: DebtPayInput) {
    const debt = await this.getOrThrow(tenantId, id);
    const amount = num(debt.amount);
    const currentPaid = num(debt.paidAmount);
    const newPaid = round2(currentPaid + input.paymentAmount);
    const paidAmount = newPaid >= amount ? amount : newPaid;
    const status = paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    const notes = input.notes ? `${debt.notes}${debt.notes ? '\n' : ''}${input.notes}` : debt.notes;

    const updated = await this.prisma.db.debt.update({
      where: { id },
      data: { paidAmount: String(paidAmount), status, notes },
    });
    const serialized = this.serialize(updated);
    return { success: true, debt: serialized, remaining: serialized.remaining };
  }

  async reminder(tenantId: string, id: string) {
    const debt = await this.getOrThrow(tenantId, id);
    if (!debt.customerPhone) throw new BadRequestException('Customer phone number is required');
    await this.outbox.enqueue({
      type: 'debt.reminder',
      tenantId,
      payload: { debtId: debt.id, phone: debt.customerPhone, customerName: debt.customerName },
    });
    return { success: true, message: 'Reminder sent via WhatsApp' };
  }

  async reminderAll(tenantId: string) {
    const debts = await this.prisma.db.debt.findMany({
      where: { tenantId, deletedAt: null, status: { in: ['unpaid', 'partial'] }, customerPhone: { not: '' } },
      select: { id: true, customerPhone: true },
    });
    for (const debt of debts) {
      await this.outbox.enqueue({
        type: 'debt.reminder',
        tenantId,
        payload: { debtId: debt.id, phone: debt.customerPhone },
      });
    }
    return { success: true, accepted: true, total: debts.length, message: `Queued ${debts.length} reminders` };
  }

  async remove(tenantId: string, id: string, userId: string) {
    const res = await this.prisma.db.debt.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    if (res.count === 0) throw new NotFoundException('Debt not found');
    return { success: true, message: 'Debt deleted' };
  }
}
