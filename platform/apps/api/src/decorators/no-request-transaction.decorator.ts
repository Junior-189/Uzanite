import { SetMetadata } from '@nestjs/common';

export const NO_REQUEST_TX_KEY = 'noRequestTransaction';

/**
 * Opts a route out of the request-wide RLS transaction. Use for handlers that
 * perform network I/O and therefore must NOT hold a database transaction open.
 * The handler is responsible for running each database operation in a short,
 * explicitly scoped transaction via `PrismaService.withTenant(...)`.
 */
export const NoRequestTransaction = () => SetMetadata(NO_REQUEST_TX_KEY, true);
