export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PaginateArgs<T> {
  findMany: (args: { where: Record<string, unknown>; take: number; orderBy: Record<string, unknown> }) => Promise<T[]>;
  where?: Record<string, unknown>;
  limit?: number;
  cursor?: string | null;
  orderBy?: Record<string, unknown>;
  maxLimit?: number;
}

/**
 * Keyset pagination by `id` (UUIDv7 = time-ordered). Callers add tenantId to
 * `where`; the extension enforces it for tenant-scoped models.
 */
export async function paginate<T extends { id: string }>(args: PaginateArgs<T>): Promise<CursorPage<T>> {
  const max = args.maxLimit ?? 100;
  const limit = Math.min(Math.max(args.limit ?? 25, 1), max);
  const where: Record<string, unknown> = { ...(args.where ?? {}) };
  if (args.cursor) where.id = { lt: args.cursor };

  const rows = await args.findMany({
    where,
    take: limit + 1,
    orderBy: args.orderBy ?? { id: 'desc' },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length ? items[items.length - 1].id : null;
  return { items, nextCursor };
}
