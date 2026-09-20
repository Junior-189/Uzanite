import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const kv = require('../../src/lib/kvStore.js');

describe('kvStore (in-memory fallback)', () => {
  it('sets, gets and deletes values', async () => {
    await kv.set('k1', { x: 1 });
    expect(await kv.get('k1')).toEqual({ x: 1 });
    await kv.del('k1');
    expect(await kv.get('k1')).toBeNull();
  });

  it('increments counters', async () => {
    expect(await kv.incr('counter')).toBe(1);
    expect(await kv.incr('counter')).toBe(2);
    expect(await kv.incr('counter')).toBe(3);
  });

  it('expires values after the TTL', async () => {
    await kv.set('ttl', 'v', 0.05);
    expect(await kv.get('ttl')).toBe('v');
    await new Promise((r) => setTimeout(r, 80));
    expect(await kv.get('ttl')).toBeNull();
  });
});
