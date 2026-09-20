import { describe, it, expect } from 'vitest';
import { formatOrderNumber } from '../../src/services/counterService.js';

describe('formatOrderNumber', () => {
  it('produces zero-padded ORD-YYYYMMDD-NNNN', () => {
    expect(formatOrderNumber(new Date('2026-09-10T12:00:00Z'), 1)).toBe('ORD-20260910-0001');
    expect(formatOrderNumber(new Date('2026-09-10T12:00:00Z'), 42)).toBe('ORD-20260910-0042');
  });

  it('pads beyond 4 digits without truncation', () => {
    expect(formatOrderNumber(new Date('2026-01-01T00:00:00Z'), 12345)).toBe('ORD-20260101-12345');
  });
});
