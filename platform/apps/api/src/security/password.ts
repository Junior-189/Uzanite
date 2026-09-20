import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { password as passwordSchema } from '@uzanite/contracts';

// argon2id parameters — OWASP baseline (19 MiB, t=2, p=1).
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface PasswordVerifyResult {
  valid: boolean;
  /** True when the stored hash should be upgraded to the current policy. */
  needsRehash: boolean;
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

function isArgon2Hash(hash: string): boolean {
  return hash.startsWith('$argon2');
}

// Legacy bcrypt hashes ($2a$/$2b$/$2y$) are still verifiable and are upgraded
// to argon2id transparently on the next successful login.
function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

function argon2NeedsRehash(hash: string): boolean {
  // Rehash if the variant or cost parameters are below the current policy.
  try {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

// Verifies a password and reports whether the stored hash is behind the current
// policy, so the caller can rehash after a successful check.
export async function verifyPasswordDetailed(plain: string, hash: string | null): Promise<PasswordVerifyResult> {
  if (!hash) return { valid: false, needsRehash: false };

  if (isArgon2Hash(hash)) {
    try {
      const valid = await argon2.verify(hash, plain);
      return { valid, needsRehash: valid ? argon2NeedsRehash(hash) : false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (isBcryptHash(hash)) {
    const valid = await bcrypt.compare(plain, hash);
    return { valid, needsRehash: valid };
  }

  // Unknown hash format — fail closed.
  return { valid: false, needsRehash: false };
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  return (await verifyPasswordDetailed(plain, hash)).valid;
}

// Returns a list of policy violations (empty when valid).
export function passwordErrors(plain: string): string[] {
  const result = passwordSchema.safeParse(plain);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

export function assertPasswordPolicy(plain: string): void {
  const errors = passwordErrors(plain);
  if (errors.length) {
    const err = new Error(`Weak password: ${errors.join(', ')}`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
}
