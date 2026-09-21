import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

/**
 * Cross-replica leader election for singleton background sweeps. Without it,
 * every worker replica runs retention/reconciliation on its own timer, which
 * multiplies DB scans and lock/WAL pressure as the fleet grows.
 *
 * Uses a Redis `SET NX EX` lock with a per-acquire token so a replica only
 * releases the lock it owns. When Redis is unset it degrades to always-acquire
 * (single-process deployment).
 */
export class LeaderLock {
  private readonly redis: Redis | null;
  private readonly tokens = new Map<string, string>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.redis = url ? new Redis(url, { maxRetriesPerRequest: null }) : null;
  }

  async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.redis) return true;
    const token = randomUUID();
    const ok = await this.redis.set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
    if (ok) this.tokens.set(key, token);
    return ok === 'OK';
  }

  async release(key: string): Promise<void> {
    if (!this.redis) return;
    const token = this.tokens.get(key);
    if (!token) return;
    this.tokens.delete(key);
    // Only delete if we still own it (the lock may have expired and been taken).
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    try {
      await this.redis.eval(script, 1, `lock:${key}`, token);
    } catch {
      /* best-effort */
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.quit();
      } catch {
        /* ignore */
      }
    }
  }
}
