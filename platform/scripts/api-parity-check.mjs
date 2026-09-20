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

// Read-only endpoints safe to compare. Writes/auth flows are validated manually.
const ENDPOINTS = [
  { name: 'auth/me', path: '/auth/me' },
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
  for (const { name, path } of ENDPOINTS) {
    const [legacy, platform] = await Promise.all([probe(LEGACY_BASE, path), probe(PLATFORM_BASE, path)]);
    console.log(`── ${name} (${path}) ─────────────────────────────`);
    line('HTTP status', `legacy=${legacy.status}  platform=${platform.status}`);

    const lk = keys(legacy.json);
    const pk = keys(platform.json);
    const top = diff(lk, pk);
    line('top-level only legacy', JSON.stringify(top.onlyLegacy));
    line('top-level only platform', JSON.stringify(top.onlyPlatform));

    const lu = keys(legacy.json?.user);
    const pu = keys(platform.json?.user);
    const user = diff(lu, pu);
    line('user keys only legacy', JSON.stringify(user.onlyLegacy));
    line('user keys only platform', JSON.stringify(user.onlyPlatform));

    const ok = legacy.status === 200 && platform.status === 200 && top.onlyLegacy.length === 0 && top.onlyPlatform.length === 0;
    line('verdict', ok ? '✅ parity (top-level)' : '⚠️  review shape differences above');
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
