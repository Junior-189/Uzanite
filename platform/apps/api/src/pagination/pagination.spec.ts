import { describe, it, expect } from 'vitest';
import { paginate } from './pagination';

// A fake ordered dataset of 25 rows.
const rows = Array.from({ length: 25 }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}` }));

const findMany = async ({ where, take }: { where: { id?: { lt: string } }; take: number }) => {
  // Mirror Prisma orderBy { id: 'desc' }.
  let data = [...rows].sort((a, b) => b.id.localeCompare(a.id));
  if (where.id?.lt) data = data.filter((r) => r.id < where.id!.lt);
  return data.slice(0, take);
};

describe('paginate (keyset)', () => {
  it('returns a page and a next cursor', async () => {
    const page = await paginate({ findMany, limit: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe('id-015');
  });

  it('continues from the cursor without overlap', async () => {
    const p1 = await paginate({ findMany, limit: 10 });
    const p2 = await paginate({ findMany, limit: 10, cursor: p1.nextCursor });
    const ids1 = new Set(p1.items.map((r) => r.id));
    expect(p2.items.every((r) => !ids1.has(r.id))).toBe(true);
  });

  it('caps the page size and ends with null cursor', async () => {
    const page = await paginate({ findMany, limit: 999, maxLimit: 100 });
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBeNull();
  });
});
