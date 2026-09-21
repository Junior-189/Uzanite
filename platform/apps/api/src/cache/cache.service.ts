import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';

/**
 * Read-through cache for hot, low-cardinality lookups.
 *
 * Why this exists: before M13 the platform had no caching at all. Every
 * authenticated request paid for a membership lookup in TenantGuard, and every
 * plan-guarded route paid for a subscription + plan + usage-counter read. Both
 * are on 100% of traffic and both change rarely, so they were the two highest
 * leverage reads in the system.
 *
 * Rules this class enforces so caching stays safe:
 * - Every entry has a short TTL, so a missed invalidation self-heals in seconds
 *   rather than persisting until a deploy.
 * - Invalidation is explicit and lives next to the write that causes it.
 * - A cache failure is never a request failure: on any Redis error we fall
 *   through to the loader and serve a correct (if slower) response.
 * - Nothing tenant-ambiguous is cached: keys always embed the tenant id.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly metrics: MetricsService
  ) {}

  /**
   * Serve `key` from cache, or run `loader` and store the result.
   *
   * @param name   logical cache name, used for hit/miss metrics
   * @param ttl    seconds; 0 bypasses the cache entirely
   * @param revive optional fixup for values that do not survive JSON (e.g. Dates)
   */
  async wrap<T>(
    name: string,
    key: string,
    ttl: number,
    loader: () => Promise<T>,
    revive?: (raw: T) => T
  ): Promise<T> {
    if (ttl <= 0) return loader();

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        this.metrics.observeCache(name, 'hit');
        const parsed = JSON.parse(cached) as T;
        return revive ? revive(parsed) : parsed;
      }
    } catch (err) {
      this.logger.warn(`Cache read failed for ${key}: ${(err as Error).message}`);
    }

    this.metrics.observeCache(name, 'miss');
    const value = await loader();

    // Never cache an absent result: negative caching here would let a
    // just-created membership or subscription look missing for a whole TTL.
    if (value !== null && value !== undefined) {
      try {
        await this.redis.set(key, JSON.stringify(value), ttl);
      } catch (err) {
        this.logger.warn(`Cache write failed for ${key}: ${(err as Error).message}`);
      }
    }
    return value;
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`Cache invalidation failed for ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Generation counter per tenant, embedded in cache keys.
   *
   * A tenant-wide change (approval, suspension, plan change) has to invalidate
   * entries for every member, but we do not know who they are without a query —
   * and Redis key scanning is not safe on a hot path. Bumping one counter
   * re-keys the whole tenant's cache atomically instead.
   */
  async generation(tenantId: string): Promise<string> {
    try {
      return (await this.redis.get(`cachegen:tenant:${tenantId}`)) ?? '0';
    } catch {
      // Unknown generation: behave as a miss rather than risk a stale hit.
      return `bypass-${Date.now()}`;
    }
  }

  /** Invalidate everything cached for a tenant. */
  async bumpGeneration(tenantId: string): Promise<void> {
    try {
      await this.redis.incr(`cachegen:tenant:${tenantId}`);
    } catch (err) {
      this.logger.warn(`Cache generation bump failed for ${tenantId}: ${(err as Error).message}`);
    }
  }

  /** Invalidate one user's membership entry plus the tenant's derived caches. */
  async invalidateMembership(userId: string, tenantId: string): Promise<void> {
    const gen = await this.generation(tenantId);
    await this.del(`membership:${gen}:${userId}:${tenantId}`);
    await this.bumpGeneration(tenantId);
  }

  /**
   * Global generation for feature-flag resolution. A global flag change affects
   * every tenant's resolved set and tenants cannot be enumerated cheaply, so a
   * single counter re-keys all `flags:*` entries atomically.
   */
  async flagsGeneration(): Promise<string> {
    try {
      return (await this.redis.get('cachegen:flags')) ?? '0';
    } catch {
      return `bypass-${Date.now()}`;
    }
  }

  async bumpFlagsGeneration(): Promise<void> {
    try {
      await this.redis.incr('cachegen:flags');
    } catch (err) {
      this.logger.warn(`Feature-flag cache generation bump failed: ${(err as Error).message}`);
    }
  }

  /** Invalidate a tenant's entitlement snapshot and all member entries. */
  async invalidateTenant(tenantId: string): Promise<void> {
    await this.del(`billing:status:${tenantId}`);
    await this.bumpGeneration(tenantId);
  }
}
