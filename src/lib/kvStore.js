// Small key/value store used for shared state that must survive across API
// instances: login lockouts, bot pause flags, etc. Uses Redis when configured,
// otherwise a bounded in-memory map (dev/tests, single instance).
const { getRedis } = require('./redis');

const mem = new Map(); // key -> { value, expires }
const MAX_MEM_KEYS = 10000;

function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expires && entry.expires < Date.now()) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key, value, ttlSeconds) {
  if (mem.size >= MAX_MEM_KEYS) {
    // Evict the oldest key (Map preserves insertion order).
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
  mem.set(key, { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
}

function parse(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function get(key) {
  const r = getRedis();
  if (!r) return memGet(key);
  return parse(await r.get(key));
}

async function set(key, value, ttlSeconds) {
  const r = getRedis();
  if (!r) {
    memSet(key, value, ttlSeconds);
    return;
  }
  const payload = JSON.stringify(value);
  if (ttlSeconds) await r.set(key, payload, 'EX', ttlSeconds);
  else await r.set(key, payload);
}

async function del(key) {
  const r = getRedis();
  if (!r) {
    mem.delete(key);
    return;
  }
  await r.del(key);
}

async function incr(key, ttlSeconds) {
  const r = getRedis();
  if (!r) {
    const next = (memGet(key) || 0) + 1;
    memSet(key, next, ttlSeconds);
    return next;
  }
  const value = await r.incr(key);
  if (ttlSeconds && value === 1) await r.expire(key, ttlSeconds);
  return value;
}

module.exports = { get, set, del, incr };
