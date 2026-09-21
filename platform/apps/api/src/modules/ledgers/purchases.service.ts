import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListPurchasesQuery, PurchaseCreateInput, PurchaseUpdateInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalStorageService } from '../../storage/local-storage.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';
import { actorOf, num, periodStart } from './ledger-utils';
import { Principal } from '../../context/tenant-context';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReceiptFile {
  buffer: Buffer;
  originalname?: string;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService
  ) {}

  private async storeReceipt(tenantId: string, file: ReceiptFile): Promise<string> {
    const ext = (file.originalname?.split('.').pop() || 'bin').toLowerCase();
    const key = LocalStorageService.newKey(tenantId, ext);
    await this.storage.put(key, file.buffer);
    return key;
  }

  private serialize<T extends { id: string; totalCost: unknown; costPerUnit: unknown; receiptKey?: string | null }>(row: T) {
    return {
      ...row,
      _id: row.id,
      totalCost: num(row.totalCost),
      costPerUnit: num(row.costPerUnit),
      receiptPath: row.receiptKey ? this.storage.url(row.receiptKey) : '',
    };
  }

  async list(tenantId: string, query: ListPurchasesQuery) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    const from = periodStart(query.period);
    if (from) where.date = { gte: from };

    type Row = { id: string; totalCost: unknown; costPerUnit: unknown; receiptKey: string | null };
    const page = await paginate<Row>({
      findMany: (args) => this.prisma.db.purchase.findMany(args as never) as Promise<Row[]>,
      where,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    const purchases = page.items.map((p) => this.serialize(p));
    const totalCost = purchases.reduce((sum, p) => sum + p.totalCost, 0);
    return { success: true, purchases, totalCost, count: purchases.length, nextCursor: page.nextCursor };
  }

  async create(tenantId: string, input: PurchaseCreateInput, principal: Principal, receipt?: ReceiptFile) {
    const clientRef = input.clientRef?.trim() ? input.clientRef.trim() : null;
    if (clientRef) {
      const existing = await this.prisma.db.purchase.findFirst({ where: { tenantId, clientRef } });
      if (existing) return { success: true, purchase: this.serialize(existing) };
    }

    const receiptKey = receipt ? await this.storeReceipt(tenantId, receipt) : input.receiptKey ?? null;
    const data = {
      id: newId(),
      tenantId,
      productId: input.productId ? input.productId : null,
      productName: input.productName,
      quantity: input.quantity,
      costPerUnit: String(round2(input.costPerUnit)),
      totalCost: String(round2(input.quantity * input.costPerUnit)),
      supplier: input.supplier ?? '',
      recordedBy: actorOf(principal),
      expiryDate: input.expiryDate instanceof Date ? input.expiryDate : null,
      date: input.date instanceof Date ? input.date : new Date(),
      notes: input.notes ?? '',
      receiptKey,
      clientRef,
    };
    try {
      const purchase = await this.prisma.db.purchase.create({ data });
      return { success: true, purchase: this.serialize(purchase) };
    } catch (err) {
      // Lost an idempotency race: return the row the other request created.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && clientRef) {
        const existing = await this.prisma.db.purchase.findFirst({ where: { tenantId, clientRef } });
        if (existing) return { success: true, purchase: this.serialize(existing) };
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, input: PurchaseUpdateInput, receipt?: ReceiptFile) {
    const purchase = await this.prisma.db.purchase.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!purchase) throw new NotFoundException('Purchase not found');

    const data: Prisma.PurchaseUpdateInput = {};
    if (input.productName !== undefined) data.productName = input.productName;
    if (input.supplier !== undefined) data.supplier = input.supplier;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.expiryDate !== undefined) data.expiryDate = input.expiryDate instanceof Date ? input.expiryDate : null;
    if (input.date !== undefined) data.date = input.date instanceof Date ? input.date : purchase.date;
    if (receipt) data.receiptKey = await this.storeReceipt(tenantId, receipt);
    else if (input.receiptKey !== undefined) data.receiptKey = input.receiptKey ? input.receiptKey : null;
    else if (input.receiptPath !== undefined) data.receiptKey = input.receiptPath ? input.receiptPath : null;

    const quantity = input.quantity ?? purchase.quantity;
    const costPerUnit = input.costPerUnit !== undefined ? input.costPerUnit : num(purchase.costPerUnit);
    if (input.quantity !== undefined) data.quantity = input.quantity;
    if (input.costPerUnit !== undefined) data.costPerUnit = String(round2(input.costPerUnit));
    if (input.quantity !== undefined || input.costPerUnit !== undefined) {
      data.totalCost = String(round2(quantity * costPerUnit));
    }

    const updated = await this.prisma.db.purchase.update({ where: { id }, data });
    return { success: true, purchase: this.serialize(updated) };
  }

  async remove(tenantId: string, id: string, userId: string) {
    const res = await this.prisma.db.purchase.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    if (res.count === 0) throw new NotFoundException('Purchase not found');
    return { success: true, message: 'Purchase deleted' };
  }
}
