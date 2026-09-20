import { describe, it, expect } from 'vitest';
import { runWithTenant, getTenantContext, setTenant } from '../../src/context/tenantContext.js';

describe('tenantContext (AsyncLocalStorage)', () => {
  it('has no context outside a run', () => {
    expect(getTenantContext()).toBeNull();
  });

  it('exposes the store inside a run', () => {
    runWithTenant({ businessId: 'biz_a', bypass: false }, () => {
      expect(getTenantContext().businessId).toBe('biz_a');
    });
  });

  it('propagates across async boundaries and supports mutation', async () => {
    await runWithTenant({ businessId: null, bypass: true }, async () => {
      await Promise.resolve();
      setTenant({ businessId: 'biz_b', bypass: false });
      expect(getTenantContext().businessId).toBe('biz_b');
    });
  });
});
