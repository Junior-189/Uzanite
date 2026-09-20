// In-process job queue used when REDIS_URL is not configured (dev/tests).
// Mirrors the essentials of BullMQ: retries with exponential backoff and a
// bounded failed-job store acting as a dead-letter queue.
const logger = require('../config/logger');

const processors = new Map(); // `${queue}:${jobName}` -> fn
const stats = new Map(); // queue -> { waiting, active, completed, failed }
const deadLetters = new Map(); // queue -> [ { jobName, data, error, at } ]
const MAX_DEAD_LETTERS = 100;

function qs(queue) {
  if (!stats.has(queue)) stats.set(queue, { waiting: 0, active: 0, completed: 0, failed: 0 });
  return stats.get(queue);
}

function bump(queue, field, delta = 1) {
  const s = qs(queue);
  s[field] = Math.max(0, (s[field] || 0) + delta);
}

function registerProcessor(queue, jobName, fn) {
  processors.set(`${queue}:${jobName}`, fn);
}

function recordDeadLetter(queue, jobName, data, error) {
  if (!deadLetters.has(queue)) deadLetters.set(queue, []);
  const list = deadLetters.get(queue);
  list.push({ jobName, data, error: String(error), at: Date.now() });
  while (list.length > MAX_DEAD_LETTERS) list.shift();
}

async function run(queue, jobName, data, attempt) {
  const fn = processors.get(`${queue}:${jobName}`);
  if (!fn) {
    logger.warn({ queue, jobName }, 'No local processor registered for job');
    return;
  }
  const maxAttempts = (data && data.__attempts) || 3;
  bump(queue, 'waiting', -1);
  bump(queue, 'active', 1);
  try {
    await fn(data);
    bump(queue, 'active', -1);
    bump(queue, 'completed', 1);
  } catch (err) {
    bump(queue, 'active', -1);
    if (attempt < maxAttempts) {
      const delay = Math.min(2 ** attempt * 1000, 30000);
      logger.warn({ queue, jobName, attempt, err: err.message }, 'Local job failed; retrying');
      setTimeout(() => run(queue, jobName, data, attempt + 1), delay);
    } else {
      bump(queue, 'failed', 1);
      recordDeadLetter(queue, jobName, data, err.message);
      logger.error({ queue, jobName, err: err.message }, 'Local job exhausted retries (dead-lettered)');
    }
  }
}

function enqueue(queue, jobName, data) {
  bump(queue, 'waiting', 1);
  setImmediate(() => run(queue, jobName, data, 1));
}

function getStats() {
  const out = {};
  for (const [queue, s] of stats.entries()) {
    out[queue] = { ...s, deadLetters: (deadLetters.get(queue) || []).length };
  }
  return out;
}

function getDeadLetters(queue) {
  return deadLetters.get(queue) || [];
}

module.exports = { registerProcessor, enqueue, getStats, getDeadLetters };
