// Shared Redis client (single connection reused by queues, KV store, and rate
// limiting). Returns null when REDIS_URL is not configured so callers can fall
// back to in-process behavior for dev/tests.
const config = require('../config/env');
const logger = require('../config/logger');

let client = null;

function isRedisEnabled() {
  return !!config.redisUrl;
}

function getRedis() {
  if (!isRedisEnabled()) return null;
  if (!client) {
    const IORedis = require('ioredis');
    client = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    client.on('error', (e) => logger.error({ err: e.message }, 'Redis connection error'));
    client.on('ready', () => logger.info('Redis connection ready'));
  }
  return client;
}

async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    /* ignore */
  }
  client = null;
}

module.exports = { isRedisEnabled, getRedis, closeRedis };
