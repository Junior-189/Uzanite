import { AsyncLocalStorage } from 'async_hooks';

export type PlatformRole = 'super_admin' | 'sub_admin';

export interface Principal {
  userId: string;
  name: string;
  platformRole: PlatformRole | null;
  tenantId: string | null;
  membershipId: string | null;
  role: string | null;
  permissions: string[];
  tokenVersion: number;
  impersonatedBy: string | null;
}

export interface RequestStore {
  requestId?: string;
  /** W3C trace context for the current request (propagated via `traceparent`). */
  traceId?: string;
  spanId?: string;
  principal?: Principal;
  tenantId?: string | null;
  system?: boolean;
  /** Transaction-scoped Prisma client (set by the unit-of-work). */
  db?: unknown;
}

const als = new AsyncLocalStorage<RequestStore>();

export function runWithRequest<T>(store: RequestStore, fn: () => T): T {
  return als.run(store, fn);
}

export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  const current = als.getStore() ?? {};
  // Await INSIDE the ALS scope: Prisma queries are lazy, so the extension hook
  // runs at execution time — it must still see the system context.
  return als.run({ ...current, system: true }, async () => fn());
}

export function getRequestStore(): RequestStore | null {
  return als.getStore() ?? null;
}

export function getTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}

/** Correlation fields for logs/error reporting, read from the active context. */
export function getCorrelation(): { requestId?: string; traceId?: string; spanId?: string; tenantId?: string | null; userId?: string } {
  const s = als.getStore();
  return {
    requestId: s?.requestId,
    traceId: s?.traceId,
    spanId: s?.spanId,
    tenantId: s?.tenantId ?? null,
    userId: s?.principal?.userId,
  };
}

export function isSystemContext(): boolean {
  return !!als.getStore()?.system;
}

export function setPrincipal(principal: Principal): void {
  const store = als.getStore();
  if (store) store.principal = principal;
}

export function setTenant(tenantId: string | null): void {
  const store = als.getStore();
  if (store) store.tenantId = tenantId;
}

export function getDb<T = unknown>(): T | null {
  return (als.getStore()?.db as T) ?? null;
}

export function setDb(db: unknown): void {
  const store = als.getStore();
  if (store) store.db = db;
}
