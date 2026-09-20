import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, Observable } from 'rxjs';
import { getRequestStore } from '../context/tenant-context';
import { NO_REQUEST_TX_KEY } from '../decorators/no-request-transaction.decorator';
import { UnitOfWorkService } from '../prisma/unit-of-work.service';

/**
 * When RLS is enabled (RLS_ENABLED=true), wrap every request in a transaction
 * that sets the tenant GUC (tenant requests) or the bypass GUC (platform/public
 * requests), so PostgreSQL Row Level Security can enforce isolation on the same
 * connection as the queries.
 *
 * Routes marked with `@NoRequestTransaction()` are skipped: they perform network
 * I/O and must manage their own short transactions (`PrismaService.withTenant`).
 *
 * When RLS is disabled, requests pass through and isolation is enforced by the
 * Prisma tenant-scope extension instead.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly uow: UnitOfWorkService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.config.get<string>('RLS_ENABLED') !== 'true') return next.handle();

    const noRequestTx = this.reflector.getAllAndOverride<boolean>(NO_REQUEST_TX_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noRequestTx) return next.handle();

    const principal = getRequestStore()?.principal;
    const run = principal?.tenantId
      ? () => this.uow.runWithTenant(principal.tenantId as string, () => lastValueFrom(next.handle()))
      : () => this.uow.runAsSystem(() => lastValueFrom(next.handle()));

    return from(run());
  }
}
