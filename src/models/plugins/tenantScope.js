// Central tenant-scoping Mongoose plugin (Phase 1, hardened in M13).
//
// When a request has a tenant context (set by `protect` + requestContext),
// every query on a tenant-scoped model is constrained to that businessId, and
// documents saved within a tenant request are pinned to that tenant.
//
// Safety properties:
//  - No context (background jobs, scripts, WhatsApp flows) => no change.
//  - `bypass` context (super_admin without an explicit tenant) => no change.
//  - If a filter already specifies businessId it is preserved (routes scope
//    explicitly), otherwise the context businessId is injected.
//  - A document that explicitly targets a *different* tenant than the active
//    context throws, preventing cross-tenant writes.
//  - `aggregate()` pipelines are scoped too (see below).
//
// M13 hardening, from the audit:
//  1. `aggregate` was NOT covered, yet aggregation is what reporting uses most.
//     Every existing pipeline happened to `$match` on businessId by hand, so
//     there was no active leak — but the safety net did not cover the riskiest
//     query shape. A `$match` stage is now prepended automatically.
//  2. The injected default is the literal string `'default'`, i.e. fail-OPEN:
//     anything created outside a tenant context lands in a shared bucket that a
//     tenant whose businessId is literally `'default'` could read.
//
//     This default is KEPT deliberately. Most models declare `businessId` with
//     the same default themselves, and legitimate flows write outside a tenant
//     context (WhatsApp webhooks, background jobs, admin tooling that passes
//     `?businessId=default`). Making it required would convert a latent
//     exposure into immediate production write failures on the live system.
//
//     Instead the condition is made OBSERVABLE: a sentinel write is logged at
//     warn level with the model name, so it can be found and fixed, and
//     `assertNoDefaultTenant()` below is used at startup to guarantee no real
//     tenant is ever assigned the sentinel id — which is what would turn the
//     shared bucket into an actual cross-tenant read.

const { getTenantContext } = require('../../context/tenantContext');

// The fail-open sentinel retained for backwards compatibility (see note 2).
const SENTINEL_TENANT_ID = 'default';

const QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'count',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
];

function activeTenantId() {
  const ctx = getTenantContext();
  if (!ctx || ctx.bypass || !ctx.businessId) return null;
  return ctx.businessId;
}

/**
 * Startup assertion: no real tenant may own the shared sentinel id.
 *
 * The sentinel bucket is only dangerous if a genuine tenant is assigned it,
 * because then unscoped writes become that tenant's readable data. Called from
 * server startup; logs and throws rather than failing silently.
 */
async function assertNoDefaultTenant(UserModel) {
  const offenders = await UserModel.countDocuments({
    role: 'tenant',
    businessId: SENTINEL_TENANT_ID,
    deletedAt: null,
  });
  if (offenders > 0) {
    throw new Error(
      `${offenders} tenant account(s) use the reserved businessId "${SENTINEL_TENANT_ID}". ` +
        'Assign each a unique businessId: unscoped writes would otherwise be readable by them.'
    );
  }
}

module.exports = function tenantScopePlugin(schema) {
  // Only add the path if the model did not already declare it.
  if (!schema.path('businessId')) {
    schema.add({
      businessId: { type: String, required: true, default: SENTINEL_TENANT_ID, index: true },
    });
  }

  // Read-path scoping.
  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function scopeQuery(next) {
      const tenantId = activeTenantId();
      if (!tenantId) return next();
      try {
        const filter = this.getFilter ? this.getFilter() : {};
        if (filter && filter.businessId === undefined) {
          filter.businessId = tenantId;
          this.setQuery(filter);
        }
      } catch {
        /* some query types may not support getFilter; ignore */
      }
      next();
    });
  }

  // Aggregation scoping. Prepends `$match: { businessId }` unless the pipeline
  // already constrains businessId itself, so hand-written pipelines keep
  // working while unscoped ones become safe by default.
  schema.pre('aggregate', function scopeAggregate(next) {
    const tenantId = activeTenantId();
    if (!tenantId) return next();

    const pipeline = this.pipeline();
    const alreadyScoped = pipeline.some(
      (stage) =>
        stage &&
        stage.$match &&
        (Object.prototype.hasOwnProperty.call(stage.$match, 'businessId') ||
          (Array.isArray(stage.$match.$and) &&
            stage.$match.$and.some((c) => c && Object.prototype.hasOwnProperty.call(c, 'businessId'))))
    );

    if (!alreadyScoped) {
      pipeline.unshift({ $match: { businessId: tenantId } });
    }
    next();
  });

  // Write-path pinning / mismatch protection.
  schema.pre('validate', function pinTenant(next) {
    const tenantId = activeTenantId();
    if (!tenantId) {
      // No tenant context: surface writes that fall back to the shared
      // sentinel so they can be traced to a caller and given a real tenant.
      if (!this.businessId || this.businessId === SENTINEL_TENANT_ID) {
        try {
          require('../../config/logger').warn(
            { model: this.constructor?.modelName || 'unknown' },
            'tenant-scope: document written with the shared sentinel businessId and no tenant context'
          );
        } catch {
          /* logging must never block a write */
        }
      }
      return next();
    }
    if (!this.businessId || this.businessId === SENTINEL_TENANT_ID) {
      this.businessId = tenantId;
      return next();
    }
    if (this.businessId !== tenantId) {
      return next(new Error('Cross-tenant write blocked: document businessId does not match request tenant'));
    }
    next();
  });

  // `insertMany` bypasses document middleware for the tenant pin above, so
  // stamp the tenant explicitly and reject mismatches.
  schema.pre('insertMany', function pinTenantMany(next, docs) {
    const tenantId = activeTenantId();
    if (!tenantId || !Array.isArray(docs)) return next();
    for (const doc of docs) {
      if (!doc) continue;
      if (!doc.businessId || doc.businessId === SENTINEL_TENANT_ID) {
        doc.businessId = tenantId;
      } else if (doc.businessId !== tenantId) {
        return next(new Error('Cross-tenant insertMany blocked: document businessId does not match request tenant'));
      }
    }
    next();
  });
};

module.exports.SENTINEL_TENANT_ID = SENTINEL_TENANT_ID;
module.exports.assertNoDefaultTenant = assertNoDefaultTenant;
