import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from './jwt.constants';

interface JwtKey {
  kid: string;
  secret: string;
}

interface JwtHeader {
  kid?: string;
  alg?: string;
}

/**
 * JWT signing key set with `kid`-based rotation.
 *
 * Configure `JWT_KEYS` as a JSON array of `{ "kid": "...", "secret": "..." }`
 * and `JWT_ACTIVE_KID` to select the signing key. Tokens are verified against
 * the key named by their header `kid`, so keys can be rotated without
 * invalidating outstanding tokens. Falls back to a single key from `JWT_SECRET`
 * (kid `default`) when `JWT_KEYS` is unset.
 */
@Injectable()
export class JwtKeyService {
  private readonly logger = new Logger(JwtKeyService.name);
  private readonly keys = new Map<string, string>();
  private readonly activeKid: string;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService
  ) {
    const secret = config.get<string>('JWT_SECRET') ?? '';
    const rawKeys = config.get<string>('JWT_KEYS') ?? '';

    let parsed: JwtKey[] = [];
    if (rawKeys) {
      try {
        const arr: unknown = JSON.parse(rawKeys);
        if (Array.isArray(arr)) {
          parsed = arr.filter(
            (k): k is JwtKey =>
              !!k && typeof (k as JwtKey).kid === 'string' && typeof (k as JwtKey).secret === 'string'
          );
        }
      } catch {
        this.logger.warn('JWT_KEYS is not valid JSON — falling back to JWT_SECRET');
      }
    }
    if (parsed.length === 0) parsed = [{ kid: 'default', secret }];
    for (const key of parsed) this.keys.set(key.kid, key.secret);

    const requested = config.get<string>('JWT_ACTIVE_KID') ?? '';
    this.activeKid = this.keys.has(requested) ? requested : parsed[0].kid;
    if (this.keys.size > 1) this.logger.log(`JWT key set active (kid=${this.activeKid}, keys=${this.keys.size})`);
  }

  private activeSecret(): string {
    const secret = this.keys.get(this.activeKid);
    if (!secret) throw new Error(`JWT active kid "${this.activeKid}" has no secret`);
    return secret;
  }

  /** Options for `JwtService.signAsync`, selecting the active key. */
  signOptions(expiresIn?: string): {
    secret: string;
    keyid: string;
    algorithm: 'HS256';
    issuer: string;
    audience: string;
    expiresIn?: string;
  } {
    return {
      secret: this.activeSecret(),
      keyid: this.activeKid,
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      ...(expiresIn ? { expiresIn } : {}),
    };
  }

  private decodeHeader(token: string): JwtHeader | null {
    try {
      const [header] = token.split('.');
      return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as JwtHeader;
    } catch {
      return null;
    }
  }

  async verify<T extends object>(token: string): Promise<T> {
    const header = this.decodeHeader(token);
    const secret = (header?.kid && this.keys.get(header.kid)) || this.keys.get('default') || this.activeSecret();
    const verifyOptions = {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    };
    try {
      return await this.jwt.verifyAsync<T>(token, { secret, ...verifyOptions });
    } catch (err) {
      // Tokens minted before a rotation may carry an unknown/absent kid — retry
      // once with the active key before giving up.
      if (secret !== this.activeSecret()) {
        return this.jwt.verifyAsync<T>(token, { secret: this.activeSecret(), ...verifyOptions });
      }
      throw err;
    }
  }
}
