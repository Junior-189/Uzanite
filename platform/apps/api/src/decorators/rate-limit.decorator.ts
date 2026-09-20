import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * How a caller is identified for throttling.
 *
 * - `ip`      — per client address. Correct for unauthenticated routes
 *               (login, webhooks). Requires `trust proxy` (see main.ts).
 * - `tenant`  — per tenant, falling back to IP when unauthenticated. Correct
 *               for tenant business APIs: in this market many SMEs share a
 *               carrier-NAT egress IP, so IP-only limits are simultaneously too
 *               strict for legitimate users and too loose for distributed abuse.
 * - `user`    — per authenticated user, falling back to IP.
 */
export type RateLimitScope = 'ip' | 'tenant' | 'user';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  keyPrefix: string;
  /** Defaults to `ip` so existing declarations keep their current behaviour. */
  scope?: RateLimitScope;
  /**
   * Optional second bucket applied in the same check. Use it to hold a global
   * ceiling while giving each tenant a smaller allowance, e.g. a webhook route
   * that must survive a burst from one sender without starving the rest.
   */
  burst?: { limit: number; windowSeconds: number; scope?: RateLimitScope };
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
