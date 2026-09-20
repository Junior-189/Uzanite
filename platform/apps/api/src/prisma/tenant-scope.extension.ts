import { Prisma } from '@prisma/client';
import { getTenantId, isSystemContext } from '../context/tenant-context';
import { TENANT_SCOPED_MODELS } from './tenant-models';

const UNIQUE_READ_OPS = new Set(['findUnique', 'findUniqueOrThrow']);
const WHERE_INJECT_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/**
 * Structural tenant isolation at the data-access layer.
 *
 * - When a tenant context is active, tenantId is injected into where/data for
 *   all tenant-scoped models, and unique reads (`findUnique`) are rejected
 *   (services must use `findFirst` with tenantId) so isolation cannot be
 *   bypassed by query shape.
 * - Outside a tenant context, access is only allowed in an explicit system
 *   context (`runAsSystem`) or it fails closed.
 *
 * PostgreSQL RLS is the planned database-level backstop (Phase M2).
 */
export function tenantScopeExtension() {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tenant-scope',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);

            const tenantId = getTenantId();
            if (!tenantId && !isSystemContext()) {
              throw new Error(
                `Tenant context required for ${model}.${operation}. Use runAsSystem() for platform operations.`
              );
            }

            const a: any = args ?? {};

            if (UNIQUE_READ_OPS.has(operation)) {
              if (!tenantId) return query(args); // explicit system context
              throw new Error(
                `${model}.${operation} is not permitted under tenant scope; use findFirst({ where: { id, tenantId } }).`
              );
            }

            if (tenantId) {
              if (WHERE_INJECT_OPS.has(operation)) {
                a.where = { ...(a.where ?? {}), tenantId };
              }
              if (operation === 'create') {
                a.data = { ...(a.data ?? {}), tenantId };
              }
              if (operation === 'createMany') {
                a.data = Array.isArray(a.data)
                  ? a.data.map((d: any) => ({ ...d, tenantId }))
                  : { ...(a.data ?? {}), tenantId };
              }
              if (operation === 'upsert') {
                a.create = { ...(a.create ?? {}), tenantId };
              }
            }

            return query(a);
          },
        },
      },
    })
  );
}
