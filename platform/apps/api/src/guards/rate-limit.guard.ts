import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitOptions, RateLimitScope } from '../decorators/rate-limit.decorator';
import { getRequestStore } from '../context/tenant-context';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';

/**
 * Redis-backed sliding-window rate limiter, shared across API replicas.
 *
 * Notes on correctness:
 * - The window slides (see RedisService.slidingWindowHit), so a caller cannot
 *   get 2x the limit by straddling a window boundary.
 * - Callers are identified per `scope`: `ip` for unauthenticated routes,
 *   `tenant`/`user` for authenticated ones. IP-only limiting is wrong for this
 *   market, where many businesses share one carrier-NAT address.
 * - `req.ip` is only meaningful because main.ts sets `trust proxy`.
 * - Standard `RateLimit-*` and `Retry-After` headers are always emitted so
 *   mobile clients and SDKs can back off instead of hot-retrying.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
    private readonly metrics: MetricsService
  ) {}

  private identity(scope: RateLimitScope, req: Request): string {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (scope === 'ip') return `ip:${ip}`;

    const principal = getRequestStore()?.principal;
    if (scope === 'tenant') {
      const tenantId = principal?.tenantId ?? (req.headers['x-tenant-id'] as string | undefined);
      return tenantId ? `tenant:${tenantId}` : `ip:${ip}`;
    }
    return principal?.userId ? `user:${principal.userId}` : `ip:${ip}`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const buckets: Array<{ limit: number; windowSeconds: number; scope: RateLimitScope; suffix: string }> = [
      {
        limit: options.limit,
        windowSeconds: options.windowSeconds,
        scope: options.scope ?? 'ip',
        suffix: '',
      },
    ];
    if (options.burst) {
      buckets.push({
        limit: options.burst.limit,
        windowSeconds: options.burst.windowSeconds,
        scope: options.burst.scope ?? options.scope ?? 'ip',
        suffix: ':burst',
      });
    }

    const member = `${Date.now()}-${randomUUID()}`;
    let remaining = Number.POSITIVE_INFINITY;
    let windowForHeader = options.windowSeconds;

    for (const bucket of buckets) {
      const key = `rl:${options.keyPrefix}${bucket.suffix}:${this.identity(bucket.scope, req)}`;

      let hit: { count: number; allowed: boolean; retryAfterSeconds: number };
      try {
        hit = await this.redis.slidingWindowHit(key, bucket.windowSeconds, bucket.limit, member);
      } catch (err) {
        // Fail OPEN on limiter infrastructure failure: a Redis blip must not
        // take the whole API down. Readiness already reports Redis health, and
        // the counter below makes the degradation visible.
        this.logger.error(`Rate limiter unavailable for ${key}: ${(err as Error).message}`);
        this.metrics.observeRateLimit(options.keyPrefix, 'error');
        return true;
      }

      if (!hit.allowed) {
        res.setHeader('Retry-After', String(hit.retryAfterSeconds));
        res.setHeader('RateLimit-Limit', String(bucket.limit));
        res.setHeader('RateLimit-Remaining', '0');
        res.setHeader('RateLimit-Reset', String(hit.retryAfterSeconds));
        this.metrics.observeRateLimit(options.keyPrefix, 'blocked');
        throw new HttpException(
          {
            success: false,
            error: 'Too many requests. Please try again later.',
            retryAfter: hit.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      const bucketRemaining = Math.max(0, bucket.limit - hit.count);
      if (bucketRemaining < remaining) {
        remaining = bucketRemaining;
        windowForHeader = bucket.windowSeconds;
      }
    }

    res.setHeader('RateLimit-Limit', String(options.limit));
    res.setHeader('RateLimit-Remaining', String(Number.isFinite(remaining) ? remaining : options.limit));
    res.setHeader('RateLimit-Reset', String(windowForHeader));
    this.metrics.observeRateLimit(options.keyPrefix, 'allowed');
    return true;
  }
}
