import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/**
 * Minimal Sentry-compatible error reporter for the worker (same Store API as the
 * API's ErrorTracker, no SDK). Always logs; forwards to Sentry when SENTRY_DSN
 * is configured. Best-effort and never throws.
 */
@Injectable()
export class WorkerErrorTracker {
  private readonly logger = new Logger(WorkerErrorTracker.name);
  private readonly storeUrl: string | null;
  private readonly authHeader: string | null;
  private readonly environment: string;

  constructor(config: ConfigService) {
    const dsn = config.get<string>('SENTRY_DSN') ?? '';
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    if (!dsn) {
      this.storeUrl = null;
      this.authHeader = null;
      return;
    }
    try {
      const url = new URL(dsn);
      const projectId = url.pathname.replace(/^\//, '');
      this.storeUrl = `${url.protocol}//${url.host}/api/${projectId}/store/`;
      this.authHeader = `Sentry sentry_version=7, sentry_client=uzanite-worker/1.0, sentry_key=${url.username}`;
    } catch {
      this.storeUrl = null;
      this.authHeader = null;
    }
  }

  capture(error: unknown, extra: Record<string, unknown> = {}): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(err.message, err.stack);
    if (!this.storeUrl || !this.authHeader) return;
    const event = {
      event_id: randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: 'error',
      environment: this.environment,
      logger: 'uzanite-worker',
      extra,
      exception: { values: [{ type: err.name, value: err.message }] },
    };
    void fetch(this.storeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sentry-Auth': this.authHeader },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    }).catch(() => undefined);
  }
}
