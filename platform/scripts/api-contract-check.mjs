#!/usr/bin/env node
/**
 * API contract gate.
 *
 * Compares the committed baseline (apps/api/openapi.json) against the spec
 * generated from the current code and fails on a BREAKING change.
 *
 * Why this exists: nothing previously verified that the platform kept its
 * promises to clients. That matters more than usual here because the Capacitor
 * Android build hard-codes its API base URL at build time, so a shipped install
 * cannot be repointed without a store update — a removed or tightened endpoint
 * bricks real users in the field.
 *
 * Breaking (fails the build):
 *   - a path+method that existed is gone
 *   - a previously optional request parameter became required
 *   - a new required parameter appeared on an existing operation
 *   - a documented success response code disappeared
 *
 * Additive (allowed): new paths, new methods, new optional parameters.
 *
 * To accept an intentional break: bump the API version, or deprecate the old
 * operation with @ApiDeprecated and keep it until its sunset date.
 *
 * Usage: node scripts/api-contract-check.mjs <baseline.json> <current.json>
 */
import { readFileSync } from 'fs';

const [baselinePath, currentPath] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  console.error('Usage: api-contract-check.mjs <baseline.json> <current.json>');
  process.exit(2);
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const baseline = read(baselinePath);
const current = read(currentPath);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const breaking = [];
const additive = [];

const operations = (spec) => {
  const out = new Map();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (item?.[method]) out.set(`${method.toUpperCase()} ${path}`, item[method]);
    }
  }
  return out;
};

const baseOps = operations(baseline);
const currOps = operations(current);

const requiredParams = (op) =>
  new Set((op.parameters ?? []).filter((p) => p.required).map((p) => `${p.in}:${p.name}`));
const allParams = (op) => new Set((op.parameters ?? []).map((p) => `${p.in}:${p.name}`));
const successCodes = (op) =>
  new Set(Object.keys(op.responses ?? {}).filter((c) => c.startsWith('2')));

for (const [key, baseOp] of baseOps) {
  const currOp = currOps.get(key);
  if (!currOp) {
    breaking.push(`REMOVED operation: ${key}`);
    continue;
  }

  const baseRequired = requiredParams(baseOp);
  const currRequired = requiredParams(currOp);
  const baseAll = allParams(baseOp);

  for (const param of currRequired) {
    if (!baseRequired.has(param)) {
      breaking.push(
        baseAll.has(param)
          ? `TIGHTENED parameter (optional -> required): ${key} ${param}`
          : `NEW REQUIRED parameter: ${key} ${param}`
      );
    }
  }

  for (const code of successCodes(baseOp)) {
    if (!successCodes(currOp).has(code)) {
      breaking.push(`REMOVED success response ${code}: ${key}`);
    }
  }

  if (currOp.deprecated && !baseOp.deprecated) additive.push(`deprecated: ${key}`);
}

for (const key of currOps.keys()) {
  if (!baseOps.has(key)) additive.push(`added: ${key}`);
}

console.log(`Baseline: ${baseOps.size} operations · Current: ${currOps.size} operations`);
if (additive.length) {
  console.log(`\nAdditive changes (allowed): ${additive.length}`);
  for (const item of additive.slice(0, 40)) console.log(`  + ${item}`);
  if (additive.length > 40) console.log(`  … ${additive.length - 40} more`);
}

if (breaking.length) {
  console.error(`\n❌ ${breaking.length} BREAKING API change(s):`);
  for (const item of breaking) console.error(`  - ${item}`);
  console.error(
    '\nEither revert, or deprecate the old operation with @ApiDeprecated (>=90 day sunset)\n' +
      'and keep it serving. If this break is intentional and approved, regenerate the\n' +
      'baseline: pnpm --filter @uzanite/api build && node dist/openapi.js openapi.json'
  );
  process.exit(1);
}

console.log('\n✅ No breaking API changes');
