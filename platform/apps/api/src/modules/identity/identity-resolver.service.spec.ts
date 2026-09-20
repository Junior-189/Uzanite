import { describe, it, expect } from 'vitest';
import { IdentityResolverService } from './identity-resolver.service';

// `isUuid` is pure; dependencies are unused for this unit test.
const svc = new IdentityResolverService({} as never, {} as never);

describe('IdentityResolverService.isUuid', () => {
  it('accepts canonical UUIDs', () => {
    expect(svc.isUuid('11111111-1111-7111-8111-111111111111')).toBe(true);
    expect(svc.isUuid('0191f2a0-1a2b-7c3d-8e4f-1234567890ab')).toBe(true);
  });

  it('rejects Mongo ObjectIds, slugs and empty values', () => {
    expect(svc.isUuid('507f1f77bcf86cd799439011')).toBe(false);
    expect(svc.isUuid('my-business-slug')).toBe(false);
    expect(svc.isUuid('')).toBe(false);
    expect(svc.isUuid(null)).toBe(false);
    expect(svc.isUuid(undefined)).toBe(false);
  });
});
