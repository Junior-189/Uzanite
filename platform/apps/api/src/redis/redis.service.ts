import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemEntry {
  value: string;
  expiresAt: number | null;
}

// Trim expired hits, count what remains, and record this hit if under the
// limit. Returns [count, oldestHitMs]. Atomic across replicas.
const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestMs = 0
  if oldest[2] then oldestMs = tonumber(oldest[2]) end
  redis.call('PEXPIRE', key, window)
  return { count + 1, oldestMs }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return { count + 1, 0 }
`;

// Shared key/value store for lockouts and other cross-instance state. Uses
// Redis when REDIS_URL is set; otherwise an in-memory fallback (dev/tests).
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly mem = new Map<string, MemEntry>();
  // Sliding-window hit timestamps, used only when Redis is absent (dev/test).
  private readonly slidingMem = new Map<string, number[]>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
      this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
      this.client.on('ready', () => this.logger.log('Redis connection ready'));
    } else {
      this.client = null;
      this.logger.warn('REDIS_URL not set — using in-memory shared state (single instance only)');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private memGet(key: string): string | null {
    const entry = this.mem.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.mem.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return this.memGet(key);
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) {
      this.mem.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      return;
    }
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async del(key: string): Promise<void> {
    if (!this.client) {
      this.mem.delete(key);
      return;
    }
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.client) {
      const next = Number(this.memGet(key) ?? 0) + 1;
      this.mem.set(key, { value: String(next), expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
      return next;
    }
    const value = await this.client.incr(key);
    if (ttlSeconds && value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  /**
   * Atomic sliding-window counter.
   *
   * A fixed window lets a caller spend the whole allowance at the end of one
   * window and again at the start of the next — 2x the intended rate across the
   * boundary. This keeps a sorted set of hit timestamps and trims anything
   * older than the window, so the limit holds over any instant of `window`.
   *
   * The whole read-trim-count-add sequence runs in one Lua script, so it is
   * atomic across API replicas.
   *
   * Returns the caller's current count and, when the limit is exceeded, how
   * many seconds until the oldest hit falls out of the window.
   */
  async slidingWindowHit(
    key: string,
    windowSeconds: number,
    limit: number,
    member: string
  ): Promise<{ count: number; allowed: boolean; retryAfterSeconds: number }> {
    const nowMs = Date.now();
    const windowMs = windowSeconds * 1000;

    if (!this.client) {
      // Dev/test fallback: same semantics, single process only.
      const hits = (this.slidingMem.get(key) ?? []).filter((ts) => ts > nowMs - windowMs);
      if (hits.length >= limit) {
        this.slidingMem.set(key, hits);
        const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - nowMs) / 1000));
        return { count: hits.length + 1, allowed: false, retryAfterSeconds };
      }
      hits.push(nowMs);
      this.slidingMem.set(key, hits);
      return { count: hits.length, allowed: true, retryAfterSeconds: 0 };
    }

    const result = (await this.client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(nowMs),
      String(windowMs),
      String(limit),
      member
    )) as [number, number];

    const [count, oldestMs] = result;
    const allowed = count <= limit;
    const retryAfterSeconds =
      allowed || !oldestMs ? 0 : Math.max(1, Math.ceil((oldestMs + windowMs - nowMs) / 1000));
    return { count, allowed, retryAfterSeconds };
  }

  async ping(): Promise<boolean> {
    if (!this.client) return true;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        /* ignore */
      }
    }
  }
}
