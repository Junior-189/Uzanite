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
