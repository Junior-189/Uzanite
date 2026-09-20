import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests: Counter<string>;
  readonly httpDuration: Histogram<string>;
  readonly paymentWebhookOutcomes: Counter<string>;
  readonly spanDuration: Histogram<string>;
  readonly rateLimitOutcomes: Counter<string>;
  readonly dbPool: Gauge<string>;
  readonly cacheOutcomes: Counter<string>;
  readonly providerCalls: Counter<string>;
  readonly providerDuration: Histogram<string>;
  readonly deprecatedRouteUse: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({
      name: 'uzanite_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'status'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'uzanite_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    // Payment webhook outcomes by provider and result (succeeded/failed/duplicate/unmatched/error).
    this.paymentWebhookOutcomes = new Counter({
      name: 'uzanite_payment_webhook_outcomes_total',
      help: 'Payment provider webhook outcomes',
      labelNames: ['provider', 'result'],
      registers: [this.registry],
    });
    // Internal span durations (tracing foundation).
    this.spanDuration = new Histogram({
      name: 'uzanite_span_duration_seconds',
      help: 'Duration of internal spans',
      labelNames: ['name'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    // Rate-limiter outcomes. `error` means the limiter itself failed and the
    // request was allowed through (fail-open) — alert on any sustained value.
    this.rateLimitOutcomes = new Counter({
      name: 'uzanite_rate_limit_outcomes_total',
      help: 'Rate limiter outcomes by route prefix',
      labelNames: ['prefix', 'result'],
      registers: [this.registry],
    });
    // Cache hit/miss by logical cache name — the signal for whether the read
    // path is actually being served from Redis.
    this.cacheOutcomes = new Counter({
      name: 'uzanite_cache_outcomes_total',
      help: 'Cache hits and misses by cache name',
      labelNames: ['cache', 'result'],
      registers: [this.registry],
    });
    // Outbound provider calls: latency and outcome, including timeouts.
    this.providerCalls = new Counter({
      name: 'uzanite_provider_calls_total',
      help: 'Outbound third-party provider calls',
      labelNames: ['provider', 'operation', 'result'],
      registers: [this.registry],
    });
    this.providerDuration = new Histogram({
      name: 'uzanite_provider_call_duration_seconds',
      help: 'Outbound provider call duration in seconds',
      labelNames: ['provider', 'operation'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });
    // Calls to deprecated routes. Removal is only safe when this hits zero.
    this.deprecatedRouteUse = new Counter({
      name: 'uzanite_deprecated_route_calls_total',
      help: 'Calls to routes marked @ApiDeprecated',
      labelNames: ['route'],
      registers: [this.registry],
    });
    // Prisma connection pool utilisation, scraped from Prisma's own metrics.
    this.dbPool = new Gauge({
      name: 'uzanite_db_pool',
      help: 'Prisma connection pool gauges',
      labelNames: ['state'],
      registers: [this.registry],
    });
  }

  observeRequest(method: string, status: number, durationSeconds: number): void {
    this.httpRequests.inc({ method, status: String(status) });
    this.httpDuration.observe({ method }, durationSeconds);
  }

  observePaymentWebhook(provider: string, result: string): void {
    this.paymentWebhookOutcomes.inc({ provider, result });
  }

  observeSpan(name: string, durationSeconds: number): void {
    this.spanDuration.observe({ name }, durationSeconds);
  }

  observeRateLimit(prefix: string, result: 'allowed' | 'blocked' | 'error'): void {
    this.rateLimitOutcomes.inc({ prefix, result });
  }

  observeCache(cache: string, result: 'hit' | 'miss'): void {
    this.cacheOutcomes.inc({ cache, result });
  }

  observeProviderCall(provider: string, operation: string, result: string, durationSeconds: number): void {
    this.providerCalls.inc({ provider, operation, result });
    this.providerDuration.observe({ provider, operation }, durationSeconds);
  }

  observeDeprecatedRouteUse(route: string): void {
    this.deprecatedRouteUse.inc({ route });
  }

  setDbPool(state: string, value: number): void {
    this.dbPool.set({ state }, value);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
