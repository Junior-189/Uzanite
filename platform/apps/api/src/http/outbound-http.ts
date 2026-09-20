/**
 * The only way this codebase makes an outbound HTTP call.
 *
 * Bare `fetch()` has no useful default timeout in Node (undici waits minutes
 * for headers and body). A hung payment provider therefore used to hold a
 * request slot, a socket and an event-loop slot for that whole time, and under
 * provider degradation those slots accumulated until the API stopped accepting
 * traffic. Every call here is bounded.
 *
 * Also provides:
 *  - a circuit breaker, so a provider that is already failing is not hammered
 *    (and callers fail fast instead of waiting for the timeout every time);
 *  - retries with jittered backoff for idempotent calls only;
 *  - latency/outcome metrics per provider and operation.
 *
 * Deliberately dependency-free: no HTTP client library, so the container image
 * and the audit surface stay small.
 */

export interface OutboundRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  /** Hard ceiling for this call. */
  timeoutMs?: number;
  /**
   * Retries for transport errors and 5xx/429 only. Leave at 0 for anything
   * that is not idempotent — a duplicated payment initiation costs real money.
   */
  retries?: number;
}

export interface OutboundResponse<T = unknown> {
  ok: boolean;
  status: number;
  json: T;
  text: string;
}

export class OutboundHttpError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'transport' | 'circuit_open',
    readonly provider: string
  ) {
    super(message);
    this.name = 'OutboundHttpError';
  }
}

export interface OutboundMetricsSink {
  observeProviderCall(provider: string, operation: string, result: string, durationSeconds: number): void;
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const BREAKER_THRESHOLD = 5; // consecutive failures before opening
const BREAKER_COOLDOWN_MS = 30_000; // how long the circuit stays open

const breakers = new Map<string, BreakerState>();

function breaker(provider: string): BreakerState {
  let state = breakers.get(provider);
  if (!state) {
    state = { failures: 0, openedAt: null };
    breakers.set(provider, state);
  }
  return state;
}

/** Exposed for tests and for the readiness/diagnostics surface. */
export function circuitState(provider: string): 'closed' | 'open' {
  const state = breakers.get(provider);
  if (!state?.openedAt) return 'closed';
  if (Date.now() - state.openedAt > BREAKER_COOLDOWN_MS) return 'closed';
  return 'open';
}

export function resetCircuits(): void {
  breakers.clear();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform a bounded outbound call.
 *
 * @param provider  provider name, for metrics and the circuit breaker
 * @param operation short operation label, for metrics
 */
export async function outboundRequest<T = unknown>(
  provider: string,
  operation: string,
  req: OutboundRequest,
  metrics?: OutboundMetricsSink
): Promise<OutboundResponse<T>> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, (req.retries ?? 0) + 1);
  const state = breaker(provider);

  if (circuitState(provider) === 'open') {
    metrics?.observeProviderCall(provider, operation, 'circuit_open', 0);
    throw new OutboundHttpError(
      `${provider} is temporarily unavailable (circuit open). Try again shortly.`,
      'circuit_open',
      provider
    );
  }
  // Cooldown elapsed: allow a probe and reset the counter.
  if (state.openedAt) {
    state.openedAt = null;
    state.failures = 0;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await fetch(req.url, {
        method: req.method ?? 'POST',
        headers: req.headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        // The whole point of this module.
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await res.text();
      let json: T;
      try {
        json = (text ? JSON.parse(text) : {}) as T;
      } catch {
        json = {} as T;
      }

      const durationSeconds = (Date.now() - startedAt) / 1000;
      const retryable = res.status === 429 || res.status >= 500;

      if (retryable && attempt < maxAttempts) {
        metrics?.observeProviderCall(provider, operation, `retry_${res.status}`, durationSeconds);
        await sleep(backoffMs(attempt));
        continue;
      }

      // A 4xx is the provider answering, not failing — it must not trip the
      // breaker, or one bad request would block every other tenant's payments.
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        state.failures = 0;
      } else {
        recordFailure(state);
      }

      metrics?.observeProviderCall(provider, operation, String(res.status), durationSeconds);
      return { ok: res.ok, status: res.status, json, text };
    } catch (err) {
      const durationSeconds = (Date.now() - startedAt) / 1000;
      const isTimeout = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError';
      lastError = new OutboundHttpError(
        isTimeout
          ? `${provider} did not respond within ${timeoutMs}ms`
          : `${provider} request failed: ${(err as Error).message}`,
        isTimeout ? 'timeout' : 'transport',
        provider
      );
      metrics?.observeProviderCall(provider, operation, isTimeout ? 'timeout' : 'transport_error', durationSeconds);
      recordFailure(state);

      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }

  throw lastError ?? new OutboundHttpError(`${provider} request failed`, 'transport', provider);
}

function recordFailure(state: BreakerState): void {
  state.failures += 1;
  if (state.failures >= BREAKER_THRESHOLD && !state.openedAt) {
    state.openedAt = Date.now();
  }
}

/** Exponential backoff with full jitter, so retries from many replicas spread. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 4000);
  return Math.floor(Math.random() * base);
}
