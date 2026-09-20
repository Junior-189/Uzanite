import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PLANS, getPlan } = require('../../src/config/plans.js');
const billing = require('../../src/services/billingService.js');

describe('SaaS plans', () => {
  it('exposes the plan catalog with limits/features', () => {
    expect(Object.keys(PLANS)).toEqual(['free', 'pro', 'business']);
    expect(getPlan('pro').limits.products).toBe(2000);
    expect(getPlan('business').limits.products).toBe(-1);
  });

  it('falls back to the free plan for unknown names', () => {
    expect(getPlan('nope').key).toBe('free');
  });

  it('decides whether sending is allowed by subscription status', () => {
    expect(billing.statusAllowsSending({ role: 'tenant', subscriptionStatus: 'active' })).toBe(true);
    expect(billing.statusAllowsSending({ role: 'tenant', subscriptionStatus: 'past_due' })).toBe(false);
    expect(billing.statusAllowsSending({ role: 'tenant', subscriptionStatus: 'canceled' })).toBe(false);
    expect(
      billing.statusAllowsSending({ role: 'tenant', subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + 60000) })
    ).toBe(true);
    expect(
      billing.statusAllowsSending({ role: 'tenant', subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() - 60000) })
    ).toBe(false);
    // Privileged accounts bypass.
    expect(billing.statusAllowsSending({ role: 'super_admin', subscriptionStatus: 'past_due' })).toBe(true);
  });
});
