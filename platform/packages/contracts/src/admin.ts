import { z } from 'zod';
import { uuid } from './common';

export const rejectTenantSchema = z
  .object({ reason: z.string().trim().max(500).optional().default('') })
  .strict();

export const suspendTenantSchema = z.object({ suspended: z.boolean() }).strict();

export const setPlanSchema = z
  .object({
    plan: z.enum(['free', 'pro', 'business']),
    subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled']).optional(),
    trialEndsAt: z.string().datetime().nullable().optional(),
    currentPeriodEnd: z.string().datetime().nullable().optional(),
  })
  .strict();

export const listTenantsQuery = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const impersonateParam = z.object({ id: uuid });

export type SetPlanInput = z.infer<typeof setPlanSchema>;
export type ListTenantsQuery = z.infer<typeof listTenantsQuery>;

// ── Feature flags (Phase M13) ───────────────────────────────────────────────
// The FeatureFlag model existed from M1 with no service and no controller, so
// flags could only be changed by direct DB writes. These contracts back a real
// administration surface, with global and per-tenant scope.

export const featureFlagKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  // Keys end up in URLs and log lines, so keep them boring and predictable.
  .regex(/^[a-z0-9_.-]+$/, 'Use lowercase letters, numbers, dot, dash or underscore');

export const upsertFeatureFlagSchema = z
  .object({
    key: featureFlagKeySchema,
    scope: z.enum(['global', 'tenant']),
    /** Required for tenant scope, forbidden for global scope. */
    tenantId: uuid.nullable().optional(),
    enabled: z.boolean(),
    message: z.string().trim().max(500).optional().default(''),
  })
  .strict()
  .refine((v) => (v.scope === 'tenant' ? !!v.tenantId : !v.tenantId), {
    message: 'tenantId is required for tenant scope and must be omitted for global scope',
  });

export const listFeatureFlagsQuery = z
  .object({
    scope: z.enum(['global', 'tenant']).optional(),
    tenantId: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .strict();

export const featureFlagIdParam = z.object({ id: uuid });

/** Path param shape shared by admin tenant routes. */
export const adminTenantIdParam = z.object({ id: uuid });

export type UpsertFeatureFlagInput = z.infer<typeof upsertFeatureFlagSchema>;
export type ListFeatureFlagsQuery = z.infer<typeof listFeatureFlagsQuery>;

// ── Feature flags: legacy keyed shape (Phase M19) ───────────────────────────
// The admin panel expects `{features:[{key,label}], global:{key:{enabled,message}}}`
// rather than the row-per-flag shape, and a per-tenant override map.
export const FEATURE_FLAGS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'orders', label: 'Orders' },
  { key: 'products', label: 'Products' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'broadcast', label: 'Email / Broadcast' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'debts', label: 'Debts' },
  { key: 'staff', label: 'Staff' },
  { key: 'reports', label: 'Reports' },
  { key: 'business', label: 'Settings' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'recycleBin', label: 'Recycle Bin' },
] as const;

export const FEATURE_KEYS = FEATURE_FLAGS.map((f) => f.key) as readonly string[];

export const featureFlagEntry = z
  .object({
    enabled: z.boolean().optional(),
    message: z.string().trim().max(500).optional(),
  })
  .strict();

export const featureFlagsUpdateSchema = z
  .object({ flags: z.record(z.string(), featureFlagEntry) })
  .strict();

export const featureFlagsTenantQuery = z.object({ tenantId: uuid.optional() }).strict();
export const featureFlagsTenantParam = z.object({ tenantId: uuid });

export type FeatureFlagsUpdateInput = z.infer<typeof featureFlagsUpdateSchema>;

// ── Admin activity logs & login attempts (Phase M19) ────────────────────────
const pageQuery = {
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  startDate: z.string().trim().max(40).optional(),
  endDate: z.string().trim().max(40).optional(),
};

export const activityLogsQuery = z
  .object({
    ...pageQuery,
    search: z.string().trim().max(120).optional(),
    userId: uuid.optional(),
  })
  .strict();

export const loginAttemptsQuery = z
  .object({
    ...pageQuery,
    status: z.string().trim().max(30).optional(),
    email: z.string().trim().max(200).optional(),
  })
  .strict();

export type ActivityLogsQuery = z.infer<typeof activityLogsQuery>;
export type LoginAttemptsQuery = z.infer<typeof loginAttemptsQuery>;
