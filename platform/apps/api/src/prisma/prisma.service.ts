import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { tenantScopeExtension } from './tenant-scope.extension';
import { getDb, getRequestStore, runWithRequest, setDb } from '../context/tenant-context';

interface RlsRoleCheck {
  role: string;
  is_superuser: boolean;
  bypass_rls: boolean;
  owns_tenants: bigint | number;
  tenants_rls_enabled: boolean | null;
  tenants_rls_forced: boolean | null;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Raw client used to open transactions and set the RLS GUCs. */
  readonly base = new PrismaClient();

  /** Tenant-scoped, extended Prisma client (app-level enforcement). */
  readonly client: PrismaClient;

  constructor(private readonly config?: ConfigService) {
    this.client = this.base.$extends(tenantScopeExtension()) as unknown as PrismaClient;
  }

  /**
   * The client services should use. When a unit-of-work transaction is active
   * (RLS mode) it returns the transaction client (RLS enforces isolation);
   * otherwise it returns the extended client (the Prisma extension enforces).
   */
  get db(): PrismaClient {
    return (getDb<PrismaClient>() as PrismaClient) ?? this.client;
  }

  /** Whether PostgreSQL Row Level Security is the active isolation mechanism. */
  get rlsEnabled(): boolean {
    return (this.config?.get<string>('RLS_ENABLED') ?? process.env.RLS_ENABLED) === 'true';
  }

  /**
   * Runs `fn` inside a tenant-scoped database transaction and exposes the tx via
   * `prisma.db`. This is the building block for routes that opt out of the
   * request-wide transaction (see `@NoRequestTransaction`) so network I/O can be
   * performed between short committed transactions.
   *
   * - If a transaction is already active (request tx), `fn` simply reuses it.
   * - With RLS on, opens a raw transaction and sets `app.current_tenant` so RLS
   *   enforces isolation.
   * - With RLS off, opens an extended-client transaction so the tenant-scope
   *   Prisma extension enforces isolation.
   */
  async withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const ambient = getDb<PrismaClient>();
    if (ambient) return fn();

    if (this.rlsEnabled) {
      return this.base.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'off', true)`;
        setDb(tx);
        try {
          return await fn();
        } finally {
          setDb(null);
        }
      });
    }

    const store = getRequestStore() ?? {};
    return runWithRequest({ ...store, tenantId, system: false }, () => this.transaction(() => fn()));
  }

  async onModuleInit(): Promise<void> {
    // Build-time tooling (OpenAPI generation) needs the module graph, not a
    // database. Never set this in a running service.
    if (process.env.SKIP_DB_CONNECT === 'true') {
      this.logger.warn('SKIP_DB_CONNECT=true — not connecting to PostgreSQL (build tooling only)');
      return;
    }
    await this.base.$connect();
    await this.verifyDatabaseGuardRails();
    await this.assertRlsSafety();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /**
   * Verifies the database-level guard rails are in place.
   *
   * These bound how long one query, one lock wait, or one idle transaction can
   * tie up a pooled connection. Without them a single pathological query holds
   * a connection and (under the request-wide transaction) its row locks
   * indefinitely — the classic way one slow endpoint takes down a healthy API.
   *
   * IMPORTANT: this only VERIFIES and warns; it deliberately does not set them.
   *
   * An earlier version issued `ALTER ROLE ... SET statement_timeout` at boot.
   * That was wrong in three ways: it mutated global role configuration as a
   * side effect of starting a process, it required privileges the application
   * role should not have, and — as the test suite proved — the catalog lock it
   * takes can deadlock against concurrent DDL, producing intermittent
   * `40P01 deadlock detected` failures. Configuration belongs in configuration.
   *
   * Set them in ONE of these places instead:
   *   - the connection string:
   *       DATABASE_URL="...?options=-c%20statement_timeout%3D15000"
   *   - the server (see docker-compose.yml, which passes -c statement_timeout)
   *   - once, by a DBA:  ALTER ROLE uzanite_app SET statement_timeout = '15s';
   */
  private async verifyDatabaseGuardRails(): Promise<void> {
    const expected = {
      statement_timeout: Number(this.config?.get<number>('DB_STATEMENT_TIMEOUT_MS') ?? 15000),
      lock_timeout: Number(this.config?.get<number>('DB_LOCK_TIMEOUT_MS') ?? 5000),
      idle_in_transaction_session_timeout: Number(this.config?.get<number>('DB_IDLE_TX_TIMEOUT_MS') ?? 15000),
    };

    try {
      const [row] = await this.base.$queryRaw<
        Array<{ statement_timeout: string; lock_timeout: string; idle_in_transaction_session_timeout: string }>
      >`
        SELECT current_setting('statement_timeout') AS statement_timeout,
               current_setting('lock_timeout') AS lock_timeout,
               current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout
      `;

      const unbounded = Object.entries(expected)
        .filter(([key]) => {
          const actual = String((row as unknown as Record<string, string>)[key] ?? '0');
          // Postgres reports "0" (or "0ms") when a timeout is disabled.
          return actual === '0' || actual === '0ms';
        })
        .map(([key, ms]) => `${key} (recommended ${ms}ms)`);

      if (unbounded.length > 0) {
        this.logger.warn(
          `Database guard rails not set: ${unbounded.join(', ')}. ` +
            'One slow query can hold a pooled connection and its locks indefinitely. ' +
            'Set them via DATABASE_URL `options=-c statement_timeout=15000`, on the server, or with ALTER ROLE.'
        );
      } else {
        this.logger.log(
          `DB guard rails active: statement_timeout=${row.statement_timeout} ` +
            `lock_timeout=${row.lock_timeout} idle_tx=${row.idle_in_transaction_session_timeout}`
        );
      }
    } catch (err) {
      this.logger.warn(`Could not read database guard-rail settings: ${(err as Error).message}`);
    }
  }

  /**
   * Fail-fast guard against running with an ineffective RLS deployment.
   *
   * PostgreSQL lets superusers / BYPASSRLS roles and (unless FORCE is set) the
   * table owner skip RLS entirely. In production that would silently disable the
   * database-level tenant isolation backstop, so we refuse to boot. Outside
   * production we only warn (tests/CI intentionally connect as a superuser).
   */
  private async assertRlsSafety(): Promise<void> {
    const isProduction = (this.config?.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';
    const rlsRequired =
      isProduction ||
      (this.config?.get<string>('RLS_ENABLED') ?? process.env.RLS_ENABLED) === 'true';

    let row: RlsRoleCheck | undefined;
    try {
      const rows = await this.base.$queryRaw<RlsRoleCheck[]>`
        SELECT
          current_user AS role,
          r.rolsuper AS is_superuser,
          r.rolbypassrls AS bypass_rls,
          (SELECT count(*)::int FROM pg_class c
             JOIN pg_roles o ON o.oid = c.relowner
            WHERE c.relname = 'tenants' AND o.rolname = current_user) AS owns_tenants,
          (SELECT relrowsecurity FROM pg_class WHERE relname = 'tenants' LIMIT 1) AS tenants_rls_enabled,
          (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenants' LIMIT 1) AS tenants_rls_forced
        FROM pg_roles r
        WHERE r.rolname = current_user
      `;
      row = rows[0];
    } catch (err) {
      this.logger.warn(`RLS role check skipped: ${(err as Error).message}`);
      return;
    }
    if (!row) return;

    const ownsTenants = Number(row.owns_tenants) > 0;
    const unsafe = row.is_superuser || row.bypass_rls || ownsTenants;
    const summary =
      `db role="${row.role}" superuser=${row.is_superuser} bypassrls=${row.bypass_rls} owns_tenants=${ownsTenants}` +
      ` rls_enabled=${row.tenants_rls_enabled} rls_forced=${row.tenants_rls_forced}`;

    if (!unsafe) {
      this.logger.log(`RLS safety check passed (${summary})`);
      return;
    }

    const message =
      `RLS is not enforceable with the connected database role. ${summary}. ` +
      'Connect as a non-owner role with NOBYPASSRLS (e.g. uzanite_app) and ensure ' +
      'migration 0012 (FORCE ROW LEVEL SECURITY) has been applied.';

    if (isProduction) throw new Error(message);
    if (rlsRequired) this.logger.warn(message);
  }

  /**
   * Runs a callback inside a DB transaction. If a unit-of-work transaction is
   * already active (RLS mode), it reuses it instead of opening a nested one
   * (which would run without the RLS GUC and be blocked).
   */
  async transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    const ambient = getDb<PrismaClient>();
    if (ambient) return fn(ambient);
    // Open a transaction on the EXTENDED client so the tenant extension applies,
    // and expose it via ALS so `prisma.db` inside the callback uses it.
    const ext = this.client as unknown as {
      $transaction: (f: (tx: PrismaClient) => Promise<T>) => Promise<T>;
    };
    return ext.$transaction(async (tx) => {
      setDb(tx);
      try {
        return await fn(tx);
      } finally {
        setDb(null);
      }
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.base.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
