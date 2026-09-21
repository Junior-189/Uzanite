#!/usr/bin/env node
// Strangler parity harness: compare the LEGACY API and the PLATFORM API for the
// wave-1 domains the client is being cut over to.
//
// It performs the SAME authenticated GET against both stacks and reports the
// top-level response keys and the `user` sub-keys, so a shape difference shows
// up before the client flips `VITE_API_V1=true`. This is a read-only,
// shadow-compare tool — it never writes.
//
// Usage:
//   LEGACY_BASE=http://localhost:3000/api \
//   PLATFORM_BASE=http://localhost:4000/api/v1 \
//   API_TOKEN=<access token> node platform/scripts/api-parity-check.mjs
//
// Get a token from whichever stack issues it; the shared JWT secret + identity
// aliases let the same token authenticate against both during the transition.

const LEGACY_BASE = (process.env.LEGACY_BASE || 'http://localhost:3000/api').replace(/\/$/, '');
const PLATFORM_BASE = (process.env.PLATFORM_BASE || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const TOKEN = process.env.API_TOKEN || '';

// Read-only endpoints safe to compare. `legacy`/`platform` may differ in path
// and shape; `pick` extracts the comparable object from each response.
const ENDPOINTS = [
  { name: 'auth/me', legacy: '/auth/me', platform: '/auth/me', pick: (j) => j?.user },
  { name: 'billing/plans', legacy: '/billing/plans', platform: '/billing/plans' },
  { name: 'billing/status', legacy: '/billing/status', platform: '/billing/status' },
  { name: 'tenant profile', legacy: '/businesses', platform: '/tenants/me', pick: (j) => (Array.isArray(j?.businesses) ? j.businesses[0] : j?.tenant) },
];

function keys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

async function probe(base, path) {
  try {
    const res = await fetch(`${base}${path}`, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _nonJson: text.slice(0, 120) };
    }
    return { status: res.status, json };
  } catch (err) {
    return { status: 'ERR', json: {}, error: err.message };
  }
}

function diff(a = [], b = []) {
  return {
    onlyLegacy: a.filter((k) => !b.includes(k)),
    onlyPlatform: b.filter((k) => !a.includes(k)),
  };
}

function line(label, value) {
  process.stdout.write(`${label.padEnd(22)} ${value}\n`);
}

async function main() {
  console.log(`Legacy:   ${LEGACY_BASE}`);
  console.log(`Platform: ${PLATFORM_BASE}`);
  console.log(`Token:    ${TOKEN ? 'set' : 'MISSING (only public endpoints will work)'}\n`);

  let mismatches = 0;
  for (const ep of ENDPOINTS) {
    const [legacy, platform] = await Promise.all([probe(LEGACY_BASE, ep.legacy), probe(PLATFORM_BASE, ep.platform)]);
    console.log(`── ${ep.name} (legacy ${ep.legacy} ↔ platform ${ep.platform}) ──`);
    line('HTTP status', `legacy=${legacy.status}  platform=${platform.status}`);

    const top = diff(keys(legacy.json), keys(platform.json));
    line('top-level only legacy', JSON.stringify(top.onlyLegacy));
    line('top-level only platform', JSON.stringify(top.onlyPlatform));

    let objOk = true;
    if (ep.pick) {
      const obj = diff(keys(ep.pick(legacy.json)), keys(ep.pick(platform.json)));
      line('object keys only legacy', JSON.stringify(obj.onlyLegacy));
      line('object keys only platform', JSON.stringify(obj.onlyPlatform));
      objOk = obj.onlyLegacy.length === 0 && obj.onlyPlatform.length === 0;
    }

    const ok = legacy.status === 200 && platform.status === 200 && top.onlyLegacy.length === 0 && top.onlyPlatform.length === 0 && objOk;
    line('verdict', ok ? '✅ parity' : '⚠️  review shape differences above');
    if (!ok) mismatches++;
    console.log('');
  }

  console.log(mismatches === 0 ? 'Parity OK for wave-1 read endpoints.' : `${mismatches} endpoint(s) need review before flipping VITE_API_V1.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
