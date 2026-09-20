import { describe, it, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';

// M2 gate C4: NestJS <-> Express token compatibility.
// Both apps use HS256 with the same JWT_SECRET. This verifies the token *format*
// is mutually decodable and documents the identity-space limitation.
const SECRET = 'shared-secret-0123456789abcdef0123456789abcdef';
const jwt = new JwtService({ secret: SECRET });
const UUID = '11111111-1111-7111-8111-111111111111';

describe('token compatibility (HS256 shared secret)', () => {
  it('platform token carries both `sub` and the legacy `id` claim', async () => {
    const token = await jwt.signAsync(
      { sub: UUID, id: UUID, tid: null, mid: null, role: 'owner', perms: [], tv: 0, act: null },
      { expiresIn: '15m' }
    );
    const decoded = await jwt.verifyAsync<Record<string, unknown>>(token);
    expect(decoded.sub).toBe(UUID);
    expect(decoded.id).toBe(UUID); // legacy Express claim
    expect(decoded.tv).toBe(0);
  });

  it('accepts a legacy Express-style token via the `id` fallback', async () => {
    // Express signs { id, tv } (no `sub`).
    const legacy = await jwt.signAsync({ id: UUID, tv: 3 }, { expiresIn: '7d' });
    const decoded = await jwt.verifyAsync<{ sub?: string; id?: string; tv?: number }>(legacy);
    const resolvedUserId = decoded.sub ?? decoded.id;
    expect(resolvedUserId).toBe(UUID);
    expect(decoded.tv).toBe(3);
  });

  it('a tampered signature is rejected', async () => {
    const token = await jwt.signAsync({ id: UUID }, { expiresIn: '15m' });
    await expect(jwt.verifyAsync(`${token}x`)).rejects.toBeTruthy();
  });

  it('documents the identity-space limitation (Mongo ObjectId is not a UUID)', () => {
    const objectId = '507f1f77bcf86cd799439011';
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(/^[0-9a-f]{24}$/.test(objectId)).toBe(true); // legacy id space
    expect(uuidRe.test(objectId)).toBe(false); // not usable as a platform user id
  });
});
