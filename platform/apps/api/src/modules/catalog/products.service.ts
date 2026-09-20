import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AdjustStockInput,
  CreateProductInput,
  ListProductsQuery,
  RestockInput,
  UpdateProductInput,
} from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from './stock.service';
import { paginate } from '../../pagination/pagination';
import { newId } from '../../ids/id';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService
  ) {}

  private async getOrThrow(tenantId: string, id: string) {
    const product = await this.prisma.db.product.findFirst({ where: { id, tenantId, deletedAt: null } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async get(tenantId: string, id: string) {
    const product = await this.getOrThrow(tenantId, id);
    return { success: true, product };
  }

  async getByBarcode(tenantId: string, barcode: string) {
    const product = await this.prisma.db.product.findFirst({ where: { tenantId, barcode, deletedAt: null } });
    if (!product) throw new NotFoundException('Product not found for this barcode');
    return { success: true, product };
  }

  /**
   * Validates that a category belongs to this tenant before linking it.
   * The FK alone would allow pointing at another tenant's category row, since
   * the constraint only checks existence — isolation has to be checked here.
   */
  private async resolveCategoryId(tenantId: string, categoryId?: string | null): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.prisma.db.category.findFirst({
      where: { id: categoryId, tenantId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category.id;
  }

  async list(tenantId: string, query: ListProductsQuery) {
    const where: Prisma.ProductWhereInput = { tenantId, deletedAt: null };
    if (query.active === 'true') where.active = true;
    if (query.active === 'false') where.active = false;
    if (query.barcode) where.barcode = query.barcode;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { barcode: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.product.findMany(args as never) as Promise<{ id: string }[]>,
      where: where as Record<string, unknown>,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return { success: true, count: page.items.length, products: page.items, nextCursor: page.nextCursor };
  }

  async create(tenantId: string, input: CreateProductInput, recordedBy: string) {
    const initialStock = input.stock ?? 0;
    let productId: string;
    try {
      productId = await this.prisma.transaction(async () => {
        const created = await this.prisma.db.product.create({
          data: {
            id: newId(),
            tenantId,
            name: input.name,
            description: input.description ?? '',
            barcode: input.barcode ? input.barcode : null,
            price: String(input.price),
            minPrice: String(input.minPrice ?? 0),
            cost: String(input.cost ?? 0),
            currency: input.currency ?? 'TZS',
            stock: 0,
            lowStockThreshold: input.lowStockThreshold ?? 5,
            expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
            expiryWarnDays: input.expiryWarnDays ?? 7,
            imageKey: input.imageKey ? input.imageKey : null,
            categoryId: await this.resolveCategoryId(tenantId, input.categoryId),
            recordedBy: input.recordedBy || recordedBy,
          },
        });
        // Initial stock is recorded as an append-only movement in the same tx.
        if (initialStock > 0) {
          await this.stock.applyChange({
            tenantId,
            productId: created.id,
            delta: initialStock,
            reason: 'restock',
            refType: 'product',
            refId: created.id,
            dedupeKey: `product:${created.id}:initial`,
            recordedBy,
          });
        }
        return created.id;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A product with this barcode already exists');
      }
      throw err;
    }
    return this.get(tenantId, productId);
  }

  async update(tenantId: string, id: string, input: UpdateProductInput, recordedBy: string) {
    await this.getOrThrow(tenantId, id);

    // Unchecked variant: includes relation scalars such as categoryId.
    const data: Prisma.ProductUncheckedUpdateManyInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.barcode !== undefined) data.barcode = input.barcode ? input.barcode : null;
    if (input.price !== undefined) data.price = String(input.price);
    if (input.minPrice !== undefined) data.minPrice = String(input.minPrice);
    if (input.cost !== undefined) data.cost = String(input.cost);
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
    if (input.expiryDate !== undefined) data.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
    if (input.expiryWarnDays !== undefined) data.expiryWarnDays = input.expiryWarnDays;
    if (input.imageKey !== undefined) data.imageKey = input.imageKey ? input.imageKey : null;
    if (input.categoryId !== undefined) data.categoryId = await this.resolveCategoryId(tenantId, input.categoryId);
    if (input.active !== undefined) data.active = input.active;
    data.version = { increment: 1 };

    try {
      if (input.version !== undefined) {
        // Optimistic concurrency.
        const res = await this.prisma.db.product.updateMany({
          where: { id, tenantId, version: input.version },
          data,
        });
        if (res.count === 0) throw new ConflictException('Product was modified by someone else — reload and retry');
      } else {
        await this.prisma.db.product.updateMany({ where: { id, tenantId }, data });
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A product with this barcode already exists');
      }
      throw err;
    }
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string, userId: string) {
    await this.getOrThrow(tenantId, id);
    await this.prisma.db.product.updateMany({
      where: { id, tenantId },
      data: { deletedAt: new Date(), deletedBy: userId, active: false, version: { increment: 1 } },
    });
    return { success: true, message: 'Product moved to recycle bin' };
  }

  async restore(tenantId: string, id: string) {
    const res = await this.prisma.db.product.updateMany({
      where: { id, tenantId, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null, active: true, version: { increment: 1 } },
    });
    if (res.count === 0) throw new NotFoundException('Product not found in recycle bin');
    return { success: true, message: 'Product restored' };
  }

  async restock(tenantId: string, id: string, input: RestockInput, recordedBy: string) {
    await this.getOrThrow(tenantId, id);
    await this.stock.applyChange({
      tenantId,
      productId: id,
      delta: input.quantity,
      reason: 'restock',
      refType: 'product',
      refId: id,
      dedupeKey: input.clientRef ? `product:${id}:restock:${input.clientRef}` : undefined,
      recordedBy,
    });
    if (input.expiryDate !== undefined) {
      await this.prisma.db.product.updateMany({
        where: { id, tenantId },
        data: { expiryDate: input.expiryDate ? new Date(input.expiryDate) : null },
      });
    }
    return this.get(tenantId, id);
  }

  async adjust(tenantId: string, id: string, input: AdjustStockInput, recordedBy: string) {
    await this.getOrThrow(tenantId, id);
    const result = await this.stock.applyChange({
      tenantId,
      productId: id,
      delta: input.delta,
      reason: 'manual_adjust',
      refType: 'product',
      refId: id,
      dedupeKey: input.clientRef ? `product:${id}:adjust:${input.clientRef}` : undefined,
      recordedBy,
    });
    return { success: true, applied: result.applied, product: result.product };
  }

  async movements(tenantId: string, productId: string, limit = 50, cursor?: string) {
    await this.getOrThrow(tenantId, productId);
    const page = await paginate<{ id: string }>({
      findMany: (args) => this.prisma.db.stockMovement.findMany(args as never) as Promise<{ id: string }[]>,
      where: { tenantId, productId },
      limit,
      cursor: cursor ?? null,
    });
    return { success: true, count: page.items.length, movements: page.items, nextCursor: page.nextCursor };
  }
}
