import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const LOCK_WINDOW_SECONDS = 30 * 60;

// Escalating lockout schedule (failures within the window -> lock duration).
const SCHEDULE: Array<{ count: number; seconds: number }> = [
  { count: 5, seconds: 5 * 60 },
  { count: 8, seconds: 15 * 60 },
  { count: 11, seconds: 30 * 60 },
  { count: 14, seconds: 2 * 60 * 60 },
  { count: 17, seconds: 6 * 60 * 60 },
  { count: 20, seconds: 24 * 60 * 60 },
];

interface LockRecord {
  history: number[];
  lockedUntil: number | null;
}

export interface LockStatus {
  locked: boolean;
  attempts: number;
  lockedUntil?: number | null;
}

@Injectable()
export class LockoutService {
  constructor(private readonly redis: RedisService) {}

  private key(email: string): string {
    return `lockout:${email.toLowerCase()}`;
  }

  private activeHistory(record: LockRecord): number[] {
    const cutoff = Date.now() - LOCK_WINDOW_SECONDS * 1000;
    return (record.history ?? []).filter((ts) => ts >= cutoff);
  }

  async check(email: string): Promise<LockStatus> {
    const raw = await this.redis.get(this.key(email));
    if (!raw) return { locked: false, attempts: 0 };
    const record = JSON.parse(raw) as LockRecord;
    if (record.lockedUntil && Date.now() > record.lockedUntil) {
      record.lockedUntil = null;
      await this.redis.set(this.key(email), JSON.stringify(record), LOCK_WINDOW_SECONDS);
      return { locked: false, attempts: this.activeHistory(record).length };
    }
    return {
      locked: !!record.lockedUntil,
      attempts: this.activeHistory(record).length,
      lockedUntil: record.lockedUntil,
    };
  }

  async recordFailure(email: string): Promise<LockRecord> {
    const raw = await this.redis.get(this.key(email));
    const record: LockRecord = raw ? (JSON.parse(raw) as LockRecord) : { history: [], lockedUntil: null };
    const history = this.activeHistory(record);
    history.push(Date.now());
    let duration: number | null = null;
    for (const step of SCHEDULE) if (history.length >= step.count) duration = step.seconds;
    if (duration && !record.lockedUntil) record.lockedUntil = Date.now() + duration * 1000;
    const next: LockRecord = { history, lockedUntil: record.lockedUntil };
    await this.redis.set(this.key(email), JSON.stringify(next), LOCK_WINDOW_SECONDS);
    return next;
  }

  async clear(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }
}
