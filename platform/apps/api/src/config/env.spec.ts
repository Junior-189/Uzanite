import { describe, it, expect } from 'vitest';
import { validateEnv, isPlaceholderSecret } from './env';

const strong = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/uzanite?schema=public',
  JWT_SECRET: strong,
};

describe('env validation (M10 hardening)', () => {
  it('accepts a strong secret in development', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'development' });
    expect(env.JWT_SECRET).toBe(strong);
    expect(env.RLS_ENABLED).toBe('false');
  });

  it('rejects a placeholder JWT secret outside the test env', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development', JWT_SECRET: 'change-me-to-a-strong-32-plus-character-secret' })
    ).toThrow(/Invalid environment/);
  });

  it('requires RLS, Redis, encryption key and https CORS in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/Invalid environment/);
  });

  it('accepts a complete production configuration', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      RLS_ENABLED: 'true',
      REDIS_URL: 'redis://redis:6379',
      ENCRYPTION_KEY: 'b'.repeat(64),
      STORAGE_SIGNING_SECRET: 'c'.repeat(64),
      CORS_ORIGINS: 'https://uzanite.shop,https://www.uzanite.shop',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.RLS_ENABLED).toBe('true');
  });

  it('rejects a localhost/http CORS origin in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        RLS_ENABLED: 'true',
        REDIS_URL: 'redis://redis:6379',
        ENCRYPTION_KEY: 'b'.repeat(64),
        CORS_ORIGINS: 'http://localhost:5173',
      })
    ).toThrow(/Invalid environment/);
  });

  it('classifies placeholder secrets', () => {
    expect(isPlaceholderSecret('changeme')).toBe(true);
    expect(isPlaceholderSecret('admin@12345!')).toBe(true);
    expect(isPlaceholderSecret(strong)).toBe(false);
  });
});
