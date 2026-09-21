import { describe, it, expect, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { LeaderLock } from '../src/leader-lock';

const URL = process.env.REDIS_URL;
const d = URL ? describe : describe.skip;

d('LeaderLock (worker singletons)', () => {
  const locks: LeaderLock[] = [];
  afterEach(async () => {
    await Promise.all(locks.map((l) => l.onModuleDestroy()));
    locks.length = 0;
  });

  const make = () => {
    const lock = new LeaderLock(new ConfigService({ REDIS_URL: URL }));
    locks.push(lock);
    return lock;
  };

  it('grants the lock to one holder and only releases its own token', async () => {
    const a = make();
    const b = make();
    expect(await a.acquire('sweep', 30)).toBe(true);
    expect(await b.acquire('sweep', 30)).toBe(false);
    await a.release('sweep');
    expect(await b.acquire('sweep', 30)).toBe(true);
    await b.release('sweep');
  });
});
