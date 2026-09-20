import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard test for SQL injection posture.
 *
 * The codebase's rule is: every query carrying client input uses Prisma's
 * tagged-template raw helpers (which parameterise) or the query builder. The
 * `*Unsafe` variants interpolate, so they are only permitted where the
 * interpolated values are provably not client-reachable — currently DDL-ish
 * statements that PostgreSQL will not accept bind parameters for.
 *
 * This test fails if a new `*Unsafe` call appears outside that allowlist, so
 * the property is enforced rather than merely reviewed once.
 */
const ALLOWED_UNSAFE_FILES = new Set([
  // ALTER ROLE / SET statement_timeout: values validated as integers, role name
  // read from `SELECT current_user`.
  'prisma/prisma.service.ts',
  // Test harness only: TRUNCATE of a fixed table list.
  'test/integration/setup.ts',
]);

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else if (/\.ts$/.test(entry)) out.push(full.slice(base.length + 1));
  }
  return out;
}

describe('SQL injection posture', () => {
  const srcRoot = join(__dirname, '..');
  const files = walk(srcRoot);

  it('uses no unsafe raw SQL outside the documented allowlist', () => {
    const offenders: string[] = [];

    for (const rel of files) {
      if (rel.endsWith('raw-sql.spec.ts')) continue;
      const content = readFileSync(join(srcRoot, rel), 'utf8');
      if (/\$(queryRawUnsafe|executeRawUnsafe)\s*\(/.test(content) && !ALLOWED_UNSAFE_FILES.has(rel)) {
        offenders.push(rel);
      }
    }

    expect(
      offenders,
      `Unsafe raw SQL found in: ${offenders.join(', ')}. Use a tagged template (\`$queryRaw\`) ` +
        'so values are parameterised, or add the file to ALLOWED_UNSAFE_FILES with a justification.'
    ).toEqual([]);
  });

  it('never interpolates into a tagged raw template', () => {
    // `$queryRaw\`...${x}...\`` is safe (Prisma parameterises), but a
    // `$queryRaw(\`...\`)` CALL with a template argument is not — that form
    // bypasses parameterisation entirely.
    const offenders: string[] = [];

    for (const rel of files) {
      if (rel.endsWith('raw-sql.spec.ts')) continue;
      const content = readFileSync(join(srcRoot, rel), 'utf8');
      if (/\$(queryRaw|executeRaw)\s*\(\s*`/.test(content)) offenders.push(rel);
    }

    expect(offenders, `Raw SQL passed as a call argument in: ${offenders.join(', ')}`).toEqual([]);
  });
});
