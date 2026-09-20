import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { getCorrelation, getRequestStore, runAsSystem } from '../context/tenant-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Audits platform-admin access to tenant data.
 *
 * `TenantGuard` lets any principal with a `platformRole` straight through, by
 * design — support staff must be able to help a tenant. But before this
 * interceptor, that access left no trace: impersonation was audited while
 * direct reads of a tenant's orders, payments or messages were not. For a
 * system holding businesses' financial records, "who looked at this" is part of
 * the security model, not an extra.
 *
 * Only cross-tenant access by a platform admin is recorded, and only for routes
 * carrying tenant context, so this adds no write to normal tenant traffic.
 * Failures never affect the response.
 */
@Injectable()
export class AdminAccessAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAccessAuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const store = getRequestStore();
    const principal = store?.principal;
    const req = context.switchToHttp().getRequest<Request>();
    const targetTenant = (req.headers['x-tenant-id'] as string | undefined) || principal?.tenantId || null;

    const isCrossTenantAdmin = !!principal?.platformRole && !!targetTenant;
    if (!isCrossTenantAdmin) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => void this.record(principal.userId, targetTenant, req),
        error: () => void this.record(principal.userId, targetTenant, req, true),
      })
    );
  }

  private async record(userId: string, tenantId: string, req: Request, failed = false): Promise<void> {
    const correlation = getCorrelation();
    // Logged unconditionally: even if the DB write fails, the access is on the
    // record in the log stream.
    this.logger.log(
      `platform-admin access user=${userId} tenant=${tenantId} ${req.method} ${req.originalUrl}` +
        `${failed ? ' (failed)' : ''} requestId=${correlation?.requestId ?? '-'}`
    );

    try {
      await runAsSystem(() =>
        this.prisma.db.activityLog.create({
          data: {
            tenantId,
            userId,
            page: 'platform_admin',
            action: `${failed ? 'admin.access.failed' : 'admin.access'}:${req.method} ${req.route?.path ?? req.originalUrl}`,
            ip: req.ip ?? null,
            userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          },
        })
      );
    } catch (err) {
      this.logger.warn(`Could not persist admin access audit: ${(err as Error).message}`);
    }
  }
}
