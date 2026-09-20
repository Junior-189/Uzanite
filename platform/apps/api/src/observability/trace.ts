import { randomBytes } from 'crypto';

// W3C Trace Context helpers (dependency-free). See
// https://www.w3.org/TR/trace-context/ — `traceparent: 00-<traceId>-<spanId>-<flags>`.

export function newTraceId(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex'); // 16 hex chars
}

export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

export function parseTraceparent(
  header?: string | string[] | null
): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || typeof value !== 'string') return null;
  const match = /^([0-9a-fA-F]{2})-([0-9a-fA-F]{32})-([0-9a-fA-F]{16})-([0-9a-fA-F]{2})(?:-.*)?$/.exec(value.trim());
  if (!match) return null;
  const version = match[1].toLowerCase();
  if (version === 'ff') return null;
  const traceId = match[2].toLowerCase();
  const parentSpanId = match[3].toLowerCase();
  if (traceId === '0'.repeat(32) || parentSpanId === '0'.repeat(16)) return null;
  return { traceId, parentSpanId, sampled: (parseInt(match[4], 16) & 0x01) === 1 };
}
