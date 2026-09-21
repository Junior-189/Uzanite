import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOrderInput } from '@uzanite/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../ids/id';

export interface ResolvedItem {
  id: string;
  productId: string | null;
  legacyProductId: string | null;
  productName: string;
  price: number;
  /** Floor price (product.minPrice) used to bound negotiated totals. */
  minPrice: number;
  currency: string;
  quantity: number;
  subtotal: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Order intake concerns: the race-free per-tenant order number and
 * server-authoritative line-item resolution. Extracted from OrdersService so it
 * is not a single object that numbers orders, prices items, moves stock, writes
 * the ledger, and enforces billing.
 */
@Injectable()
export class OrderIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Race-free order number, per tenant per UTC day. */
  async nextOrderNumber(tenantId: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rows = await this.prisma.db.$queryRaw<Array<{ seq: number }>>`
      INSERT INTO "order_counters" ("tenant_id", "day", "seq")
      VALUES (${tenantId}::uuid, ${day}, 1)
      ON CONFLICT ("tenant_id", "day")
      DO UPDATE SET "seq" = "order_counters"."seq" + 1
      RETURNING "seq"
    `;
    const seq = Number(rows[0]?.seq ?? 1);
    return `ORD-${day}-${String(seq).padStart(4, '0')}`;
  }

  /** Server-authoritative pricing; one query for all referenced products. */
  async resolveItems(tenantId: string, inputs: CreateOrderInput['items']): Promise<ResolvedItem[]> {
    const productIds = [...new Set(inputs.map((i) => i.productId).filter((id): id is string => !!id))];
    const products = productIds.length
      ? await this.prisma.db.product.findMany({
          where: { id: { in: productIds }, tenantId, deletedAt: null },
          select: { id: true, name: true, price: true, minPrice: true, currency: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const resolved: ResolvedItem[] = [];
    for (const input of inputs) {
      const product = input.productId ? byId.get(input.productId) ?? null : null;
      if (input.productId && !product) throw new NotFoundException(`Product ${input.productId} not found`);

      const listPrice = product ? round2(Number(product.price)) : undefined;
      const floorPrice = product ? round2(Number(product.minPrice)) : 0;

      // Server-authoritative pricing: a client may not override a product-backed
      // line outside the tenant's [minPrice, price] range.
      if (product && input.price !== undefined) {
        const requested = round2(input.price);
        if (requested < floorPrice || requested > (listPrice as number)) {
          throw new BadRequestException(
            `Item price for ${product.name} must be between ${floorPrice} and ${listPrice} ${product.currency}`
          );
        }
      }

      const price = input.price !== undefined ? round2(input.price) : listPrice ?? 0;
      const currency = (input.currency ?? product?.currency ?? 'TZS').toUpperCase();
      const productName = input.productName?.trim() || product?.name || 'Item';
      resolved.push({
        id: newId(),
        productId: product?.id ?? null,
        legacyProductId: input.legacyProductId ?? null,
        productName,
        price,
        minPrice: floorPrice,
        currency,
        quantity: input.quantity,
        subtotal: round2(price * input.quantity),
      });
    }
    return resolved;
  }
}
