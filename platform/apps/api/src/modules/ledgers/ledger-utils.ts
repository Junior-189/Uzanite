import { Principal } from '../../context/tenant-context';

/** Start of the period in UTC (mirrors the orders/catalog period logic). */
export function periodStart(period?: string): Date | null {
  if (!period || period === 'all' || period === 'alltime') return null;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (period) {
    case 'daily':
      return start;
    case 'weekly': {
      const dow = start.getUTCDay();
      start.setUTCDate(start.getUTCDate() - (dow === 0 ? 6 : dow - 1));
      return start;
    }
    case 'monthly':
      start.setUTCDate(1);
      return start;
    case 'yearly':
    case 'annually':
      start.setUTCMonth(0, 1);
      return start;
    default:
      return null;
  }
}

/** Legacy `recordedBy`: staff record under their name, owners as "Owner". */
export function actorOf(principal: Principal): string {
  if (principal.role === 'staff') return principal.name || 'Staff';
  return principal.role === 'owner' || principal.role === 'manager' ? principal.name || 'Owner' : principal.name || principal.userId;
}

/** Decimal -> number so JSON matches the legacy numeric fields. */
export function num(value: unknown): number {
  return Number(value ?? 0);
}
