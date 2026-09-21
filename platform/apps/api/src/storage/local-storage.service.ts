import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

/**
 * Local-disk private object storage with HMAC-signed, expiring download URLs.
 *
 * - Keys are opaque, flat (`<tenantId>_<timestamp>_<random>.<ext>`), and
 *   validated against a strict charset so a key can never traverse the root.
 * - Signed URLs bind `key + exp (+ tenantId)`; verification is timing-safe and
 *   rejects expired links. Bytes never sit in a web-served directory.
 *
 * S3/R2 can implement the same interface later; callers depend only on `put`,
 * `get`, `remove`, `url`, and `verify`.
 */
@Injectable()
export class LocalStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly root: string;
  private readonly signingKey: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.root = resolve(process.cwd(), config.get<string>('STORAGE_LOCAL_DIR') ?? 'private_uploads_platform');
    this.ttlSeconds = config.get<number>('STORAGE_URL_TTL_SECONDS') ?? 900;

    const secret =
      config.get<string>('STORAGE_SIGNING_SECRET') ||
      config.get<string>('ENCRYPTION_KEY') ||
      config.get<string>('JWT_SECRET') ||
      '';
    if (!secret) {
      throw new Error('STORAGE_SIGNING_SECRET (or ENCRYPTION_KEY / JWT_SECRET) is required for signed file URLs');
    }
    if (!config.get<string>('STORAGE_SIGNING_SECRET')) {
      this.logger.warn('STORAGE_SIGNING_SECRET not set — deriving the file-signing key from another secret');
    }
    this.signingKey = secret;
  }

  static newKey(tenantId: string, ext: string): string {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const rand = randomBytes(10).toString('hex');
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8);
    return `${tenantId}_${stamp}_${rand}.${safeExt}`;
  }

  private safePath(key: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(`${this.root}/`)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.safePath(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.safePath(key));
    } catch {
      /* already gone */
    }
  }

  private hmac(key: string, exp: number): string {
    return createHmac('sha256', this.signingKey).update(`${key}:${exp}`).digest('hex');
  }

  sign(key: string, ttlSeconds = this.ttlSeconds): { exp: number; sig: string } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return { exp, sig: this.hmac(key, exp) };
  }

  verify(key: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = this.hmac(key, exp);
    const a = Buffer.from(String(sig ?? ''));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Relative URL the API serves the object from. */
  url(key: string): string {
    const { exp, sig } = this.sign(key);
    return `/api/v1/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
  }
}
