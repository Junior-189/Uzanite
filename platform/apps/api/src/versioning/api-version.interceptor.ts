import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable } from 'rxjs';
import {
  API_DEPRECATION_KEY,
  ApiDeprecationOptions,
  CURRENT_API_VERSION,
} from './api-version';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Stamps every response with the serving API version, and emits standard
 * deprecation signals for routes marked with `@ApiDeprecated`.
 *
 * Deprecated-route usage is counted, because the only safe basis for removing
 * an endpoint is evidence that nobody is calling it any more.
 */
@Injectable()
export class ApiVersionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ApiVersionInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly metrics: MetricsService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const res = http.getResponse<Response>();
    if (!res?.setHeader) return next.handle();

    res.setHeader('X-API-Version', CURRENT_API_VERSION);

    const deprecation = this.reflector.getAllAndOverride<ApiDeprecationOptions>(API_DEPRECATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (deprecation) {
      // RFC 9745 / RFC 8594: both dates as HTTP-dates.
      res.setHeader('Deprecation', new Date(deprecation.since).toUTCString());
      res.setHeader('Sunset', new Date(deprecation.sunset).toUTCString());
      if (deprecation.replacedBy) {
        res.setHeader('Link', `<${deprecation.replacedBy}>; rel="successor-version"`);
      }
      res.setHeader(
        'Warning',
        `299 - "Deprecated API. ${deprecation.note ?? 'This endpoint will stop responding after the Sunset date.'}"`
      );

      const route = `${http.getRequest().method} ${http.getRequest().route?.path ?? http.getRequest().originalUrl}`;
      this.metrics.observeDeprecatedRouteUse(route);
    }

    return next.handle();
  }
}
