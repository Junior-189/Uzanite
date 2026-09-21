import { PrismaClient } from '@prisma/client';

/**
 * A single shared Prisma client for the worker process. Previously every
 * service constructed its own `new PrismaClient()` (four independent connection
 * pools per replica), which multiplies Postgres connections as workers scale.
 */
export const workerPrisma = new PrismaClient();
