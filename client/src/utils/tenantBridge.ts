import { isRoutedToPlatform } from './apiRouting';

/**
 * Compatibility bridge for the Tenancy domain (wave-1, after auth).
 *
 * Legacy: `GET /businesses` → `{ businesses: [ { businessId, name, phone, currency, payment:{mpesa,tigo,airtel} } ] }`,
 *         `PUT /businesses/:id` with flat payment fields.
 * Platform: `GET /tenants/me` → `{ tenant: { id, slug, name, phone, currency, paymentMethods:[{provider,number,accountName}] } }`,
 *         `PUT /tenants/me` (name/phone/currency/theme) + `POST /tenants/me/payment-methods` per provider.
 *
 * This module maps between the two so the Business page can cut over without a
 * rewrite. Cutover is gated by `VITE_API_V1` + the `/tenants` prefix.
 */

export const BUSINESS_PROVIDERS = ['mpesa', 'tigo', 'airtel'] as const;
export type BusinessProvider = (typeof BUSINESS_PROVIDERS)[number];

export interface LegacyPaymentMethod {
  number?: string;
  name?: string;
}

export interface LegacyBusiness {
  businessId?: string;
  _id?: string;
  name?: string;
  phone?: string;
  currency?: string;
  description?: string;
  payment?: Partial<Record<BusinessProvider, LegacyPaymentMethod>>;
  mpesaNumber?: string;
  mpesaName?: string;
  tigoNumber?: string;
  airtelNumber?: string;
  [key: string]: unknown;
}

interface PlatformPaymentMethod {
  provider?: string;
  number?: string;
  accountName?: string;
}

interface PlatformTenant {
  id?: string;
  slug?: string;
  name?: string;
  phone?: string | null;
  currency?: string;
  paymentMethods?: PlatformPaymentMethod[];
}

/** True when tenancy calls should go to the NestJS platform. */
export function tenantsOnPlatform(): boolean {
  return isRoutedToPlatform('/tenants/me');
}

/** Maps a platform tenant (+ its payment methods) to the legacy business shape. */
export function adaptPlatformTenant(tenant: PlatformTenant): LegacyBusiness {
  const payment: Partial<Record<BusinessProvider, LegacyPaymentMethod>> = {};
  for (const method of tenant.paymentMethods ?? []) {
    if (method?.provider && (BUSINESS_PROVIDERS as readonly string[]).includes(method.provider)) {
      payment[method.provider as BusinessProvider] = { number: method.number ?? '', name: method.accountName ?? '' };
    }
  }
  return {
    businessId: tenant.slug || tenant.id,
    _id: tenant.id,
    name: tenant.name,
    phone: tenant.phone ?? '',
    currency: tenant.currency || 'TZS',
    payment,
  };
}

/** Flattens the nested legacy payment object into the form's flat fields. */
export function normalizeBusiness(business: LegacyBusiness): LegacyBusiness {
  return {
    ...business,
    mpesaNumber: business.mpesaNumber ?? business.payment?.mpesa?.number ?? '',
    mpesaName: business.mpesaName ?? business.payment?.mpesa?.name ?? '',
    tigoNumber: business.tigoNumber ?? business.payment?.tigo?.number ?? '',
    airtelNumber: business.airtelNumber ?? business.payment?.airtel?.number ?? '',
    currency: business.currency || 'TZS',
  };
}

/** The path to call for the current tenant's own business profile. */
export function businessProfilePath(): string {
  return tenantsOnPlatform() ? '/tenants/me' : '/businesses';
}

/** Builds a platform payment-method upsert payload. */
export function paymentMethodPayload(provider: BusinessProvider, number: string, accountName: string) {
  return { provider, number, accountName, active: true };
}
