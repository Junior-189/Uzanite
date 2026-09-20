import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { getCorrelation, getRequestStore } from '../context/tenant-context';
import { ErrorTrackerService } from '../observability/error-tracker.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly tracker: ErrorTrackerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlation = getCorrelation();
    const { requestId, traceId } = correlation;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { success: false, error: 'Internal server error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        body = { success: false, error: response };
      } else {
        body = { success: false, ...(response as Record<string, unknown>) };
      }
    } else if (exception instanceof Error) {
      this.logger.error(`${req.method} ${req.url} — ${exception.message}`, exception.stack);
      if (process.env.NODE_ENV !== 'production') {
        body = { success: false, error: exception.message };
      }
    }

    // Report server-side failures (5xx + unhandled) to the error tracker.
    if (status >= 500) {
      this.tracker.captureException(exception, {
        requestId,
        traceId,
        tenantId: correlation.tenantId,
        userId: correlation.userId,
        path: req.url,
        method: req.method,
        status,
        extra: { route: req.route?.path, body: this.safeBody(req) },
      });
    }

    // Echo correlation ids so a client-visible failure can be traced.
    body.requestId = requestId;
    body.traceId = traceId;

    res.status(status).json(body);
  }

  private safeBody(req: Request): Record<string, unknown> | undefined {
    const store = getRequestStore();
    if (!store || !req.body || typeof req.body !== 'object') return undefined;
    // Never forward secrets in an error report.
    const { password, currentPassword, newPassword, refreshToken, accessToken, ...rest } = req.body as Record<string, unknown>;
    return rest;
  }
}
