import * as bcrypt from 'bcryptjs';
import { password as passwordSchema } from '@uzanite/contracts';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
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
