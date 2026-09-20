import { SetMetadata } from '@nestjs/common';

/**
 * API evolution support.
 *
 * The platform serves `/api/v1` while the legacy Express app serves an
 * unversioned `/api`, and the Capacitor build hard-codes its API base URL at
 * build time — so a shipped Android install cannot be repointed without a store
 * update. That makes a machine-readable deprecation signal load-bearing rather
 * than cosmetic: clients need to learn that an endpoint is going away while
 * they can still be updated.
 *
 * Headers follow RFC 9745 (`Deprecation`) and RFC 8594 (`Sunset`), so standard
 * tooling and API gateways understand them without custom parsing.
 */
export const API_DEPRECATION_KEY = 'apiDeprecation';

export const CURRENT_API_VERSION = 'v1';

/** Minimum notice before an endpoint may be removed. */
export const MIN_DEPRECATION_WINDOW_DAYS = 90;

export interface ApiDeprecationOptions {
  /** ISO date the endpoint was marked deprecated. */
  since: string;
  /** ISO date it may stop responding. Must be >= 90 days after `since`. */
  sunset: string;
  /** What callers should use instead — returned in a `Link` header. */
  replacedBy?: string;
  /** Short human-readable note, surfaced in a `Warning` header. */
  note?: string;
}

/**
 * Marks a route as deprecated. Prefer this over silently changing behaviour:
 * add the new endpoint, deprecate the old one, and remove it only after the
 * sunset date has passed and traffic has actually stopped.
 */
export const ApiDeprecated = (options: ApiDeprecationOptions) => SetMetadata(API_DEPRECATION_KEY, options);
