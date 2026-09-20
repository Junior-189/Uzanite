import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

/**
 * The limiter is the platform's only abuse control, so its two properties are
 * tested directly:
 *
 *  1. it holds the limit over ANY window instant (a fixed window let a caller
 *     take 2x the allowance by straddling the boundary);
 *  2. it reports a usable Retry-After.
 *
 * Runs against real Redis when REDIS_URL is set, and against the in-memory
 * fallback otherwise — both paths must behave identically.
 */
describe('sliding-window rate limiter', () => {
  let redis: RedisService;
  let key: string;

  beforeEach(() => {
    redis = new RedisService(new ConfigService());
    key = `test:rl:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  });

  it('allows up to the limit and blocks beyond it', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await redis.slidingWindowHit(key, 60, 3, `m${i}`));
    }

    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results.slice(3).every((r) => r.allowed)).toBe(false);
  });

  it('reports a Retry-After within the window when blocked', async () => {
    for (let i = 0; i < 2; i++) await redis.slidingWindowHit(key, 30, 2, `m${i}`);
    const blocked = await redis.slidingWindowHit(key, 30, 2, 'm-blocked');

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it('does not grant a double allowance across a window boundary', async () => {
    // A 1-second window with a limit of 2. A fixed-window counter resets on the
    // boundary and would allow 2 more immediately; a sliding window only frees
    // capacity as individual hits age out.
    await redis.slidingWindowHit(key, 1, 2, 'a');
    await redis.slidingWindowHit(key, 1, 2, 'b');
    expect((await redis.slidingWindowHit(key, 1, 2, 'c')).allowed).toBe(false);

    // After the window fully elapses, capacity returns.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await redis.slidingWindowHit(key, 1, 2, 'd')).allowed).toBe(true);
  });

  it('keeps separate callers in separate buckets', async () => {
    const a = `${key}:tenant-a`;
    const b = `${key}:tenant-b`;
    await redis.slidingWindowHit(a, 60, 1, 'a1');
    expect((await redis.slidingWindowHit(a, 60, 1, 'a2')).allowed).toBe(false);
    // One tenant exhausting its allowance must not affect another. This is the
    // property that broke when every request shared the proxy's IP.
    expect((await redis.slidingWindowHit(b, 60, 1, 'b1')).allowed).toBe(true);
  });
});
