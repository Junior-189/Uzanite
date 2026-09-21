import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ExpenseCreateInput, ListExpensesQuery } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { actorOf, num, periodStart } from './ledger-utils';
import { Principal } from '../../context/tenant-context';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(row: { id: string; amount: unknown }) {
    return { ...row, _id: row.id, amount: num(row.amount) };
  }

  async list(tenantId: string, query: ListExpensesQuery) {
    const where: Record<string, unknown> = { tenantId };
    const from = periodStart(query.period);
    if (from) where.date = { gte: from };

    const page = await paginate<{ id: string; amount: unknown }>({
      findMany: (args) => this.prisma.db.expense.findMany(args as never) as Promise<{ id: string; amount: unknown }[]>,
      where,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const expenses = page.items.map((e) => this.serialize(e));
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    return { success: true, expenses, total, count: expenses.length, nextCursor: page.nextCursor };
  }

  async create(tenantId: string, input: ExpenseCreateInput, principal: Principal) {
    const clientRef = input.clientRef?.trim() ? input.clientRef.trim() : null;
    if (clientRef) {
      const existing = await this.prisma.db.expense.findFirst({ where: { tenantId, clientRef } });
      if (existing) return { success: true, expense: this.serialize(existing) };
    }
    try {
      const expense = await this.prisma.db.expense.create({
        data: {
          id: newId(),
          tenantId,
          description: input.description,
          amount: String(input.amount),
          category: input.category ?? 'Other',
          recordedBy: actorOf(principal),
          clientRef,
          ...(input.date ? { date: input.date } : {}),
        },
      });
      return { success: true, expense: this.serialize(expense) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && clientRef) {
        const existing = await this.prisma.db.expense.findFirst({ where: { tenantId, clientRef } });
        if (existing) return { success: true, expense: this.serialize(existing) };
      }
      throw err;
    }
  }

  async remove(tenantId: string, id: string) {
    const res = await this.prisma.db.expense.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException('Expense not found');
    return { success: true, message: 'Expense deleted' };
  }
}
