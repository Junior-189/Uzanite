import { describe, it, expect } from 'vitest';
import {
  adaptPlatformTenant,
  businessProfilePath,
  normalizeBusiness,
  paymentMethodPayload,
  tenantsOnPlatform,
} from './tenantBridge';

describe('tenantBridge (platform tenant → legacy business)', () => {
  it('adapts a platform tenant with payment methods to the legacy shape', () => {
    const business = adaptPlatformTenant({
      id: 't1',
      slug: 'biz_abc',
      name: 'Shop',
      phone: '255700000000',
      currency: 'TZS',
      paymentMethods: [{ provider: 'mpesa', number: '255700000000', accountName: 'Shop' }],
    });
    expect(business.businessId).toBe('biz_abc');
    expect(business._id).toBe('t1');
    expect(business.payment?.mpesa?.number).toBe('255700000000');
    expect(business.payment?.tigo).toBeUndefined();
  });

  it('flattens nested payment into the form fields', () => {
    const normalized = normalizeBusiness({
      payment: { mpesa: { number: '1', name: 'M' }, tigo: { number: '2' } },
    });
    expect(normalized.mpesaNumber).toBe('1');
    expect(normalized.mpesaName).toBe('M');
    expect(normalized.tigoNumber).toBe('2');
    expect(normalized.airtelNumber).toBe('');
    expect(normalized.currency).toBe('TZS');
  });

  it('uses the legacy business path while the cutover flag is off', () => {
    expect(tenantsOnPlatform()).toBe(false);
    expect(businessProfilePath()).toBe('/businesses');
  });

  it('builds a platform payment-method payload', () => {
    expect(paymentMethodPayload('mpesa', '255700000000', 'Shop')).toEqual({
      provider: 'mpesa',
      number: '255700000000',
      accountName: 'Shop',
      active: true,
    });
  });
});
