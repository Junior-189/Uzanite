import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ErrorTrackerService } from './error-tracker.service';

describe('ErrorTrackerService (Sentry-compatible)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is disabled without a DSN and capture never throws', () => {
    const tracker = new ErrorTrackerService(new ConfigService({}));
    expect(tracker.enabled).toBe(false);
    expect(() => tracker.captureException(new Error('boom'), { traceId: 't' })).not.toThrow();
  });

  it('posts a well-formed event to the Sentry Store API when configured', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const tracker = new ErrorTrackerService(new ConfigService({ SENTRY_DSN: 'https://pubkey@o1.ingest.sentry.io/42' }));
    expect(tracker.enabled).toBe(true);
    tracker.captureException(new Error('boom'), { requestId: 'r', traceId: 't', tenantId: 'ten', path: '/x', method: 'GET' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://o1.ingest.sentry.io/api/42/store/');
    expect(opts.headers['X-Sentry-Auth']).toContain('sentry_key=pubkey');
    const event = JSON.parse(opts.body);
    expect(event.exception.values[0].value).toBe('boom');
    expect(event.tags.tenant_id).toBe('ten');
    expect(event.extra.trace_id).toBe('t');
  });
});
