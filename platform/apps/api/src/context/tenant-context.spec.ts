import { describe, it, expect } from 'vitest';
import { runAsSystem, runWithRequest, getRequestStore, getTenantId } from './tenant-context';

// Regression tests for M2 gate C1 fix #1: AsyncLocalStorage context must survive
// await boundaries (Prisma queries are lazy and execute after the ALS callback).
describe('tenant-context', () => {
  it('runAsSystem preserves the system flag across async boundaries', async () => {
    const seen = await runAsSystem(async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      return getRequestStore()?.system;
    });
    expect(seen).toBe(true);
  });

  it('runWithRequest preserves the tenant id across async boundaries', async () => {
    const tenant = await runWithRequest({ tenantId: 'tenant-123' }, async () => {
      await new Promise((r) => setTimeout(r, 2));
      return getTenantId();
    });
    expect(tenant).toBe('tenant-123');
  });

  it('has no context outside a run', () => {
    expect(getRequestStore()).toBeNull();
    expect(getTenantId()).toBeNull();
  });
});
