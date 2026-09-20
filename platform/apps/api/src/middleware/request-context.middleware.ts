import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequest } from '../context/tenant-context';
import { formatTraceparent, newSpanId, newTraceId, parseTraceparent } from '../observability/trace';

// Establishes the AsyncLocalStorage request store before guards run, assigns a
// request id, and continues an incoming W3C trace (or starts a new one). Both
// correlation ids are echoed back in the response headers.
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  const incoming = parseTraceparent(req.headers['traceparent']);
  const traceId = incoming?.traceId ?? newTraceId();
  const spanId = newSpanId();

  res.setHeader('X-Request-Id', requestId);
  res.setHeader('traceparent', formatTraceparent(traceId, spanId, true));

  runWithRequest({ requestId, tenantId: null, traceId, spanId }, () => next());
}
