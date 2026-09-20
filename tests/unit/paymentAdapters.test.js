import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getProvider, listProviders } = require('../../src/payments/index.js');
const paymentService = require('../../src/services/paymentService.js');

describe('payments adapters', () => {
  it('manual provider is always enabled', () => {
    expect(getProvider('manual').enabled()).toBe(true);
    expect(listProviders().find((p) => p.name === 'manual').enabled).toBe(true);
  });

  it('clickpesa/azampay are disabled without credentials', () => {
    expect(getProvider('clickpesa').enabled()).toBe(false);
    expect(getProvider('azampay').enabled()).toBe(false);
  });

  it('returns null for unknown providers', () => {
    expect(getProvider('nope')).toBeNull();
  });

  it('maps provider statuses to internal states', () => {
    expect(paymentService.mapStatus('success')).toBe('succeeded');
    expect(paymentService.mapStatus('COMPLETED')).toBe('succeeded');
    expect(paymentService.mapStatus('FAILED')).toBe('failed');
    expect(paymentService.mapStatus('processing')).toBe('processing');
    expect(paymentService.mapStatus('weird')).toBe('pending');
  });

  it('parses provider webhook payloads', () => {
    const parsed = getProvider('clickpesa').parseWebhook({
      data: { orderReference: 'REF1', status: 'success', amount: 1000, currency: 'TZS' },
    });
    expect(parsed.providerRef).toBe('REF1');
    expect(parsed.status).toBe('success');
    expect(parsed.amount).toBe(1000);
  });

  it('rejects unsigned webhooks when no secret is configured', () => {
    expect(getProvider('clickpesa').verifySignature('body', {})).toBe(false);
  });
});
