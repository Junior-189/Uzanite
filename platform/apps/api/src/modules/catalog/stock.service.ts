import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { newId } from '../../ids/id';

export interface StockChange {
  tenantId: string;
  productId: string;
  delta: number;
  reason: StockReason;
  refType?: string;
  refId?: string;
  dedupeKey?: string;
  recordedBy?: string;
}

/**
 * The single controlled path for every stock change. Writes an append-only
 * stock_movement and updates the products.stock balance in the same transaction.
 *
 * Invariants:
 *  - stock never goes negative (conditional update + DB CHECK constraint)
 *  - each change is applied exactly once (dedupeKey) and is always auditable
 *  - low/out-of-stock outbox events fire when thresholds are crossed
 *
 * ORDERING IS LOAD-BEARING. The movement row is claimed *before* the balance
 * moves, so the `(tenant_id, dedupe_key)` unique index is what serializes
 * concurrent duplicates. If the balance were updated first (as it once was), two
 * concurrent callers with the same dedupeKey would both pass an existence check,
 * both increment the balance, and the loser's duplicate-key error would be
 * swallowed — committing a double application with only one movement row to
 * explain it. Claim first, then move the balance: a duplicate can never apply.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService
  ) {}

  async applyChange(change: StockChange): Promise<{ applied: boolean; product: { id: string; name: string; stock: number } }> {
    const { tenantId, productId, delta, reason, dedupeKey } = change;
    if (delta === 0) throw new ConflictException('Stock delta must be non-zero');
    if (!Number.isInteger(delta)) throw new ConflictException('Stock delta must be a whole number');

    return this.prisma.transaction(async () => {
      const movementId = newId();

      // ── Step 1: claim the dedupe key by inserting the movement row.
      // `balanceAfter` is backfilled in step 3 once the real balance is known.
      // `skipDuplicates` means a replay or a concurrent duplicate inserts
      // nothing and reports count === 0, without aborting the transaction the
      // way a caught P2002 would.
      if (dedupeKey) {
        const claim = await this.prisma.db.stockMovement.createMany({
          data: [
            {
              id: movementId,
              tenantId,
              productId,
              productName: '',
              quantity: delta,
              balanceAfter: 0,
              reason,
              refType: change.refType ?? null,
              refId: change.refId ?? null,
              dedupeKey,
              recordedBy: change.recordedBy ?? null,
            },
          ],
          skipDuplicates: true,
        });

        if (claim.count === 0) {
          // Already applied (replay or concurrent duplicate). The balance is
          // whatever the original application left it at — never touch it.
          const current = await this.prisma.db.product.findFirst({
            where: { id: productId, tenantId },
            select: { id: true, name: true, stock: true },
          });
          if (!current) throw new NotFoundException('Product not found');
          return { applied: false, product: current };
        }
      }

      // ── Step 2: atomic conditional balance update — refuses to go negative.
      const where: Prisma.ProductWhereInput =
        delta < 0
          ? { id: productId, tenantId, deletedAt: null, stock: { gte: -delta } }
          : { id: productId, tenantId, deletedAt: null };

      const result = await this.prisma.db.product.updateMany({
        where,
        data: { stock: { increment: delta }, version: { increment: 1 } },
      });

      if (result.count === 0) {
        // Throwing rolls back the claim from step 1, so the dedupe key is
        // released and a corrected retry can succeed.
        const exists = await this.prisma.db.product.findFirst({
          where: { id: productId, tenantId },
          select: { name: true },
        });
        if (!exists) throw new NotFoundException('Product not found');
        throw new ConflictException(`Insufficient stock for ${exists.name}`);
      }

      const product = await this.prisma.db.product.findFirst({
        where: { id: productId, tenantId },
        select: { id: true, name: true, stock: true, lowStockThreshold: true },
      });
      if (!product) throw new NotFoundException('Product not found');

      // ── Step 3: complete the audit row with the resulting balance.
      if (dedupeKey) {
        await this.prisma.db.stockMovement.updateMany({
          where: { id: movementId, tenantId },
          data: { productName: product.name, balanceAfter: product.stock },
        });
      } else {
        // No dedupe key: nothing to serialize on, so write the row directly.
        await this.prisma.db.stockMovement.create({
          data: {
            id: movementId,
            tenantId,
            productId,
            productName: product.name,
            quantity: delta,
            balanceAfter: product.stock,
            reason,
            refType: change.refType ?? null,
            refId: change.refId ?? null,
            dedupeKey: null,
            recordedBy: change.recordedBy ?? null,
          },
        });
      }

      // Outbox events on threshold crossings (consumed by Notifications).
      if (product.stock === 0) {
        await this.outbox.enqueue({
          type: 'product.out_of_stock',
          tenantId,
          payload: { productId, name: product.name, stock: 0 },
        });
      } else if (product.stock <= product.lowStockThreshold) {
        await this.outbox.enqueue({
          type: 'product.low_stock',
          tenantId,
          payload: { productId, name: product.name, stock: product.stock, threshold: product.lowStockThreshold },
        });
      }

      return { applied: true, product: { id: product.id, name: product.name, stock: product.stock } };
    });
  }
}
