import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { getRequestStore, runWithRequest, setDb } from '../context/tenant-context';

/**
 * Unit of work: runs a callback inside a PostgreSQL transaction and sets the
 * RLS GUCs for that transaction. This is how Row Level Security gets the
 * `app.current_tenant` / `app.bypass_rls` settings it needs.
 *
 * - runWithTenant: `SET LOCAL app.current_tenant = <id>` (tenant requests)
 * - runAsSystem:   `SET LOCAL app.bypass_rls = 'on'`    (platform/system work)
 *
 * Both methods establish an AsyncLocalStorage store (inheriting any existing
 * one) and expose the transaction client via `prisma.db`, so callers — including
 * guards that run before the request interceptor — are always consistent.
 */
@Injectable()
export class UnitOfWorkService {
  constructor(private readonly prisma: PrismaService) {}

  async runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const store = getRequestStore() ?? {};
    return runWithRequest({ ...store, tenantId, system: false }, () =>
      this.prisma.base.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'off', true)`;
        setDb(tx);
        try {
          return await fn();
        } finally {
          setDb(null);
        }
      })
    );
  }

  async runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
    const store = getRequestStore() ?? {};
    return runWithRequest({ ...store, system: true }, () =>
      this.prisma.base.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        setDb(tx);
        try {
          return await fn();
        } finally {
          setDb(null);
        }
      })
    );
  }
}
