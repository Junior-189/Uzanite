import { describe, it, expect } from 'vitest';
import { LockoutService } from './lockout.service';
import { RedisService } from '../redis/redis.service';

// In-memory stub mirroring the RedisService surface used by LockoutService.
function stubRedis(): RedisService {
  const mem = new Map<string, { value: string; expiresAt: number | null }>();
  const api = {
    enabled: false,
    async get(key: string) {
      const e = mem.get(key);
      if (!e) return null;
      if (e.expiresAt && e.expiresAt < Date.now()) {
        mem.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key: string, value: string, ttl?: number) {
      mem.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
    },
    async del(key: string) {
      mem.delete(key);
    },
    async incr(key: string) {
      const next = Number((await api.get(key)) ?? 0) + 1;
      mem.set(key, { value: String(next), expiresAt: null });
      return next;
    },
    async ping() {
      return true;
    },
  };
  return api as unknown as RedisService;
}

describe('LockoutService', () => {
  it('escalates after repeated failures and clears', async () => {
    const svc = new LockoutService(stubRedis());
    const email = 'lock@example.com';

    expect((await svc.check(email)).locked).toBe(false);
    for (let i = 0; i < 5; i++) await svc.recordFailure(email);
    const after = await svc.check(email);
    expect(after.locked).toBe(true);
    expect(after.attempts).toBeGreaterThanOrEqual(5);

    await svc.clear(email);
    expect((await svc.check(email)).locked).toBe(false);
  });
});
