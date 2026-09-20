import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRequestStore } from '../context/tenant-context';
import { MetricsService } from '../metrics/metrics.service';
import { formatTraceparent, newSpanId, newTraceId } from './trace';

export interface SpanHandle {
  traceId: string;
  spanId: string;
  end(attributes?: Record<string, unknown>, status?: 'ok' | 'error'): void;
}

interface BufferedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startUnixNano: string;
  endUnixNano: string;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error';
}

/**
 * Distributed-tracing foundation. Every request already carries a W3C trace
 * context (see request-context.middleware). This service records internal spans,
 * exposes their durations as Prometheus metrics, and — when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set — batches them to an OTLP/HTTP collector
 * as OTLP JSON. No OpenTelemetry SDK dependency is required.
 */
const TRACE_EXPORT_TIMEOUT_MS = 3000;

@Injectable()
export class TracingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TracingService.name);
  private readonly serviceName: string;
  private readonly endpoint: string;
  private readonly release: string;
  private readonly maxBuffer = 500;
  private buffer: BufferedSpan[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService
  ) {
    this.serviceName = config.get<string>('OTEL_SERVICE_NAME') ?? 'uzanite-api';
    this.endpoint = (config.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') ?? '').replace(/\/$/, '');
    this.release = config.get<string>('APP_RELEASE') ?? 'unknown';
  }

  get exporting(): boolean {
    return this.endpoint.length > 0;
  }

  onApplicationBootstrap(): void {
    if (this.exporting) {
      this.timer = setInterval(() => void this.flush().catch(() => undefined), 5000);
      this.logger.log(`OTLP span export enabled → ${this.endpoint}`);
    }
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}): SpanHandle {
    const store = getRequestStore();
    const traceId = store?.traceId ?? newTraceId();
    const parentSpanId = store?.spanId;
    const spanId = newSpanId();
    const start = process.hrtime.bigint();

    const attrs = { ...attributes };
    let ended = false;
    return {
      traceId,
      spanId,
      end: (extra?: Record<string, unknown>, status: 'ok' | 'error' = 'ok') => {
        if (ended) return;
        ended = true;
        const end = process.hrtime.bigint();
        this.metrics.observeSpan(name, Number(end - start) / 1e9);
        if (!this.exporting) return;
        this.buffer.push({
          traceId,
          spanId,
          parentSpanId,
          name,
          startUnixNano: start.toString(),
          endUnixNano: end.toString(),
          attributes: { ...attrs, ...(extra ?? {}) },
          status,
        });
        if (this.buffer.length >= this.maxBuffer) void this.flush().catch(() => undefined);
      },
    };
  }

  /** Best-effort OTLP/HTTP JSON export. Never throws. */
  async flush(): Promise<void> {
    if (!this.exporting || this.buffer.length === 0) return;
    const spans = this.buffer;
    this.buffer = [];
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.serviceName } },
              { key: 'service.version', value: { stringValue: this.release } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'uzanite' },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                name: s.name,
                kind: 1,
                startTimeUnixNano: s.startUnixNano,
                endTimeUnixNano: s.endUnixNano,
                attributes: Object.entries(s.attributes).map(([key, value]) => ({
                  key,
                  value:
                    typeof value === 'number'
                      ? { doubleValue: value }
                      : typeof value === 'boolean'
                        ? { boolValue: value }
                        : { stringValue: String(value) },
                })),
                status: { code: s.status === 'error' ? 2 : 1 },
              })),
            },
          ],
        },
      ],
    };
    try {
      await fetch(`${this.endpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // A slow collector must not slow the API down.
        signal: AbortSignal.timeout(TRACE_EXPORT_TIMEOUT_MS),
      });
    } catch {
      /* best-effort; drop the batch */
    }
  }

  /** Convenience for callers that only need the current traceparent header. */
  currentTraceparent(): string | null {
    const store = getRequestStore();
    if (!store?.traceId || !store.spanId) return null;
    return formatTraceparent(store.traceId, store.spanId);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush().catch(() => undefined);
  }
}
