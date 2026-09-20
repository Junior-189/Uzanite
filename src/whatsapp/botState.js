// Tracks which businesses have their auto-reply bot paused. Backed by the
// shared KV store (Redis when configured) so the flag is consistent across API
// instances and survives restarts.
const kv = require('../lib/kvStore');

const keyFor = (businessId) => `bot:paused:${businessId || 'default'}`;

async function pauseBot(businessId = 'default') {
  await kv.set(keyFor(businessId), true);
}

async function resumeBot(businessId = 'default') {
  await kv.del(keyFor(businessId));
}

async function isBotPaused(businessId = 'default') {
  return !!(await kv.get(keyFor(businessId)));
}

module.exports = { pauseBot, resumeBot, isBotPaused };
