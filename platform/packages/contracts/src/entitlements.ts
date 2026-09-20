// Canonical plan entitlement catalogue (Phase M13).
//
// Before this existed, plan limits enforced nothing: `@EnforceLimit('ordersPerMonth')`
// guarded order creation but no plan defined that key (so the check passed),
// `products` was defined but never counted, and `hasFeature` returned true for
// any feature a plan JSON simply omitted. Plan tiers were marketing copy rather
// than entitlements — a direct revenue leak.
//
// The fix is a single registry that both the seed data and the guards read, so a
// metric cannot be enforced without being defined, and a feature cannot be
// checked without being declared.

/** Usage metrics that can carry a plan limit. */
export const LIMIT_METRICS = [
  'products',
  'staff',
  'ordersPerMonth',
  'broadcastsPerMonth',
  'whatsappMessagesPerMonth',
] as const;

export type LimitMetric = (typeof LIMIT_METRICS)[number];

/**
 * How a metric accumulates.
 * - `lifetime` — a current count of live rows (products, staff). Reconciled
 *   from the table of record, so a delete frees allowance.
 * - `monthly`  — resets each calendar month (UTC), counted per period key.
 */
export const LIMIT_METRIC_PERIOD: Record<LimitMetric, 'lifetime' | 'monthly'> = {
  products: 'lifetime',
  staff: 'lifetime',
  ordersPerMonth: 'monthly',
  broadcastsPerMonth: 'monthly',
  whatsappMessagesPerMonth: 'monthly',
};

/** Plan features that can be gated. */
export const PLAN_FEATURES = [
  'orders',
  'products',
  'notifications',
  'broadcast',
  'reports',
  'payments',
  'whatsapp',
  'api',
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

export function isKnownLimitMetric(value: string): value is LimitMetric {
  return (LIMIT_METRICS as readonly string[]).includes(value);
}

export function isKnownPlanFeature(value: string): value is PlanFeature {
  return (PLAN_FEATURES as readonly string[]).includes(value);
}

export interface PlanDefinition {
  key: string;
  name: string;
  priceTzs: number;
  /** Every metric must be present. -1 = unlimited. */
  limits: Record<LimitMetric, number>;
  /** Every feature must be present. Absence is never treated as granted. */
  features: Record<PlanFeature, boolean>;
}

/**
 * The plan catalogue. Exhaustive `Record` types mean adding a metric or feature
 * to the lists above is a compile error until every plan declares a value —
 * which is what stops the "feature silently granted to everyone" class of bug.
 */
export const PLAN_CATALOGUE: readonly PlanDefinition[] = [
  {
    key: 'free',
    name: 'Free',
    priceTzs: 0,
    limits: {
      products: 50,
      staff: 2,
      ordersPerMonth: 200,
      broadcastsPerMonth: 1,
      whatsappMessagesPerMonth: 500,
    },
    features: {
      orders: true,
      products: true,
      notifications: true,
      broadcast: true,
      reports: false,
      payments: false,
      whatsapp: true,
      api: false,
    },
  },
  {
    key: 'pro',
    name: 'Pro',
    priceTzs: 25000,
    limits: {
      products: 2000,
      staff: 10,
      ordersPerMonth: 10000,
      broadcastsPerMonth: 50,
      whatsappMessagesPerMonth: 20000,
    },
    features: {
      orders: true,
      products: true,
      notifications: true,
      broadcast: true,
      reports: true,
      payments: true,
      whatsapp: true,
      api: false,
    },
  },
  {
    key: 'business',
    name: 'Business',
    priceTzs: 75000,
    limits: {
      products: -1,
      staff: -1,
      ordersPerMonth: -1,
      broadcastsPerMonth: -1,
      whatsappMessagesPerMonth: -1,
    },
    features: {
      orders: true,
      products: true,
      notifications: true,
      broadcast: true,
      reports: true,
      payments: true,
      whatsapp: true,
      api: true,
    },
  },
] as const;

/** Applied when a tenant has no subscription row at all. */
export const DEFAULT_PLAN_KEY = 'free';

export function planByKey(key: string): PlanDefinition | undefined {
  return PLAN_CATALOGUE.find((p) => p.key === key);
}
