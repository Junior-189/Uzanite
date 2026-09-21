import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtKeyService } from './jwt-keys.service';
import { JWT_AUDIENCE, JWT_ISSUER } from './jwt.constants';

const SECRET_A = 'a'.repeat(48);
const SECRET_B = 'b'.repeat(48);

const makeKeys = (env: Record<string, string>) =>
  new JwtKeyService(new ConfigService(env), new JwtService());

describe('JwtKeyService (kid rotation)', () => {
  it('falls back to JWT_SECRET with the default kid', async () => {
    const jwt = new JwtService();
    const keys = makeKeys({ JWT_SECRET: SECRET_A });
    const token = await jwt.signAsync({ sub: 'u1' }, keys.signOptions('5m'));
    expect((await keys.verify<{ sub: string }>(token)).sub).toBe('u1');
  });

  it('rotates the signing key while still verifying tokens from the previous kid', async () => {
    const jwt = new JwtService();
    const keySet = JSON.stringify([
      { kid: '2026-06', secret: SECRET_A },
      { kid: '2026-09', secret: SECRET_B },
    ]);

    const oldSigner = makeKeys({ JWT_SECRET: SECRET_A, JWT_KEYS: keySet, JWT_ACTIVE_KID: '2026-06' });
    const oldToken = await jwt.signAsync({ sub: 'u1' }, oldSigner.signOptions('5m'));

    const newSigner = makeKeys({ JWT_SECRET: SECRET_A, JWT_KEYS: keySet, JWT_ACTIVE_KID: '2026-09' });
    // A token signed with the previous key still verifies.
    expect((await newSigner.verify<{ sub: string }>(oldToken)).sub).toBe('u1');

    // New tokens use the active kid and verify under either signer.
    const newToken = await jwt.signAsync({ sub: 'u2' }, newSigner.signOptions('5m'));
    const header = JSON.parse(Buffer.from(newToken.split('.')[0], 'base64url').toString('utf8'));
    expect(header.kid).toBe('2026-09');
    expect((await oldSigner.verify<{ sub: string }>(newToken)).sub).toBe('u2');
  });

  it('rejects a token signed with a key outside the set', async () => {
    const jwt = new JwtService();
    const keys = makeKeys({ JWT_SECRET: SECRET_A });
    const foreign = await jwt.signAsync(
      { sub: 'x' },
      { secret: SECRET_B, keyid: 'default', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
    );
    await expect(keys.verify(foreign)).rejects.toBeTruthy();
  });
});
