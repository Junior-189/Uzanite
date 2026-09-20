import { describe, it, expect } from 'vitest';
import { formatTraceparent, newSpanId, newTraceId, parseTraceparent } from './trace';

describe('W3C trace context helpers', () => {
  it('formats and parses a traceparent round-trip', () => {
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const header = formatTraceparent(traceId, spanId, true);
    expect(header).toBe(`00-${traceId}-${spanId}-01`);
    expect(parseTraceparent(header)).toEqual({ traceId, parentSpanId: spanId, sampled: true });
  });

  it('propagates an incoming trace id from the header', () => {
    const traceId = '1'.repeat(32);
    const parsed = parseTraceparent(`00-${traceId}-${'2'.repeat(16)}-00`);
    expect(parsed?.traceId).toBe(traceId);
    expect(parsed?.sampled).toBe(false);
  });

  it('rejects malformed or all-zero contexts', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`)).toBeNull();
    expect(parseTraceparent('ff-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01')).toBeNull();
  });

  it('generates correctly shaped ids', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
