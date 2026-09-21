import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';

const svc = new LocalStorageService(
  new ConfigService({
    STORAGE_LOCAL_DIR: 'tmp-local-storage-test',
    STORAGE_SIGNING_SECRET: 'x'.repeat(40),
    STORAGE_URL_TTL_SECONDS: 900,
  })
);

describe('LocalStorageService', () => {
  it('signs and verifies a key', () => {
    const { exp, sig } = svc.sign('k1');
    expect(svc.verify('k1', exp, sig)).toBe(true);
    // A different key or a tampered signature fails.
    expect(svc.verify('k2', exp, sig)).toBe(false);
    expect(svc.verify('k1', exp, `${sig}0`)).toBe(false);
  });

  it('rejects expired links', () => {
    const { exp, sig } = svc.sign('k1');
    expect(svc.verify('k1', exp - 10, sig)).toBe(false);
  });

  it('rejects path-traversal keys', async () => {
    await expect(svc.put('../escape', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    await expect(svc.get('a/b')).rejects.toThrow(/Invalid storage key/);
  });

  it('generates flat, opaque keys', () => {
    expect(LocalStorageService.newKey('t1', 'jpg')).toMatch(/^t1_\d{14}_[0-9a-f]{20}\.jpg$/);
  });
});
