import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export interface ErrorContext {
  requestId?: string;
  traceId?: string;
  tenantId?: string | null;
  userId?: string;
  path?: string;
  method?: string;
  status?: number;
  extra?: Record<string, unknown>;
}

/**
 * Dependency-free error tracking. When `SENTRY_DSN` is configured it submits
 * events to Sentry's Store API over HTTPS (no SDK needed); otherwise it logs a
 * structured error line. Capture is best-effort and never throws.
 */
// Error reporting must never become the outage.
const ERROR_REPORT_TIMEOUT_MS = 3000;
const MAX_IN_FLIGHT_EVENTS = 20;

@Injectable()
export class ErrorTrackerService {
  private inFlight = 0;
  private dropped = 0;

  private readonly logger = new Logger(ErrorTrackerService.name);
  private readonly storeUrl: string | null;
  private readonly authHeader: string | null;
  private readonly environment: string;
  private readonly release: string;

  constructor(config: ConfigService) {
    const dsn = config.get<string>('SENTRY_DSN') ?? '';
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    this.release = config.get<string>('APP_RELEASE') ?? 'unknown';
    const parsed = dsn ? this.parseDsn(dsn) : null;
    this.storeUrl = parsed?.storeUrl ?? null;
    this.authHeader = parsed?.authHeader ?? null;
  }

  private parseDsn(dsn: string): { storeUrl: string; authHeader: string } | null {
    try {
      const url = new URL(dsn);
      const projectId = url.pathname.replace(/^\//, '');
      const publicKey = url.username;
      if (!projectId || !publicKey) return null;
      return {
        storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
        authHeader:
          `Sentry sentry_version=7, sentry_client=uzanite/1.0, sentry_key=${publicKey}` +
          (url.password ? `, sentry_secret=${url.password}` : ''),
      };
    } catch {
      return null;
    }
  }

  get enabled(): boolean {
    return this.storeUrl !== null;
  }

  /** Fire-and-forget capture; never blocks or throws. */
  captureException(error: unknown, context: ErrorContext = {}): void {
    const err = error instanceof Error ? error : new Error(String(error));
    const eventId = randomUUID().replace(/-/g, '');

    this.logger.error(
      `${context.method ?? ''} ${context.path ?? ''} — ${err.message}`.trim(),
      err.stack
    );

    if (!this.storeUrl || !this.authHeader) return;

    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: 'error',
      environment: this.environment,
      release: this.release,
      logger: 'uzanite-api',
      tags: {
        ...(context.tenantId ? { tenant_id: context.tenantId } : {}),
        ...(context.method ? { http_method: context.method } : {}),
      },
      user: context.userId ? { id: context.userId } : undefined,
      request: context.path ? { url: context.path, method: context.method } : undefined,
      extra: {
        request_id: context.requestId,
        trace_id: context.traceId,
        http_status: context.status,
        ...(context.extra ?? {}),
      },
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            stacktrace: err.stack ? { frames: this.stackFrames(err.stack) } : undefined,
          },
        ],
      },
    };

    // Bounded and capped. During an error storm an unbounded fire-and-forget
    // fetch accumulates pending promises and sockets, turning a bad minute into
    // an outage. Over the cap we drop events rather than amplify the incident.
    if (this.inFlight >= MAX_IN_FLIGHT_EVENTS) {
      this.dropped += 1;
      return;
    }
    this.inFlight += 1;
    void fetch(this.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': this.authHeader,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(ERROR_REPORT_TIMEOUT_MS),
    })
      .catch(() => undefined)
      .finally(() => {
        this.inFlight -= 1;
        if (this.dropped > 0 && this.inFlight === 0) {
          this.logger.warn(`Dropped ${this.dropped} error report(s) while over the in-flight cap`);
          this.dropped = 0;
        }
      });
  }

  // Sentry expects frames oldest-first with filename/function/lineno.
  private stackFrames(stack: string): Array<{ filename: string; function: string; lineno: number }> {
    return stack
      .split('\n')
      .slice(1)
      .map((line) => {
        const m = /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
        if (!m) return null;
        return { function: (m[1] ?? '<anonymous>').trim(), filename: m[2], lineno: Number(m[3]) };
      })
      .filter((f): f is { filename: string; function: string; lineno: number } => f !== null)
      .reverse();
  }
}
