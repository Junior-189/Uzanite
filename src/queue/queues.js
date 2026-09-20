// Queue abstraction: BullMQ + Redis when REDIS_URL is configured, otherwise an
// in-process fallback (see localQueue.js) so dev/tests work without Redis.
const config = require('../config/env');
const localQueue = require('./localQueue');
const { getRedis } = require('../lib/redis');

const QUEUES = ['whatsapp-outbound', 'broadcast', 'receipts', 'email', 'maintenance', 'payments', 'dlq'];
const redisEnabled = !!config.redisUrl;
const queues = new Map();

function getRedisConnection() {
  return getRedis();
}

function getQueue(name) {
  if (!redisEnabled) return null;
  if (!queues.has(name)) {
    const { Queue } = require('bullmq');
    queues.set(name, new Queue(name, { connection: getRedisConnection() }));
  }
  return queues.get(name);
}

let localProcessorsRegistered = false;
function ensureLocalProcessors() {
  if (redisEnabled || localProcessorsRegistered) return;
  localProcessorsRegistered = true;
  require('./worker').registerLocalProcessors();
}

async function enqueue(name, jobName, data, opts = {}) {
  if (redisEnabled) {
    const q = getQueue(name);
    return q.add(jobName, data, {
      attempts: opts.attempts || 3,
      backoff: opts.backoff || { type: 'exponential', delay: 2000 },
      removeOnComplete: opts.removeOnComplete !== undefined ? opts.removeOnComplete : 1000,
      removeOnFail: false,
      ...opts,
    });
  }
  ensureLocalProcessors();
  localQueue.enqueue(name, jobName, data);
  return { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
}

async function getQueueStats() {
  if (!redisEnabled) {
    return { mode: 'in-process', queues: localQueue.getStats() };
  }
  const out = {};
  for (const name of QUEUES) {
    const q = getQueue(name);
    out[name] = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  }
  return { mode: 'redis', queues: out };
}

async function getDeadLetters(limit = 50) {
  if (!redisEnabled) {
    const { getDeadLetters: local } = require('./localQueue');
    return local('dlq').slice(-limit);
  }
  const q = getQueue('dlq');
  const jobs = await q.getFailed(0, limit - 1);
  return jobs.map((j) => ({ jobName: j.name, data: j.data, failedReason: j.failedReason }));
}

function isRedisEnabled() {
  return redisEnabled;
}

module.exports = {
  QUEUES,
  enqueue,
  getQueue,
  getQueueStats,
  getDeadLetters,
  isRedisEnabled,
  getRedisConnection,
  ensureLocalProcessors,
};
