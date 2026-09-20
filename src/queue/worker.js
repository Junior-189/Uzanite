// Messaging worker: registers job processors and runs BullMQ workers (Redis)
// or the in-process fallback.
const logger = require('../config/logger');
const localQueue = require('./localQueue');
const { isRedisEnabled, getRedisConnection, getQueue } = require('./queues');

const jobModules = [
  require('../jobs/whatsappJob'),
  require('../jobs/emailJob'),
  require('../jobs/receiptJob'),
  require('../jobs/broadcastJob'),
  require('../jobs/maintenanceJob'),
  require('../jobs/paymentJob'),
];

let registry = null;

function getRegistry() {
  if (registry) return registry;
  registry = new Map();
  for (const mod of jobModules) {
    for (const [queue, handlers] of Object.entries(mod)) {
      for (const [jobName, fn] of Object.entries(handlers)) {
        registry.set(`${queue}:${jobName}`, fn);
      }
    }
  }
  return registry;
}

// Used by the local (no-Redis) queue.
function registerLocalProcessors() {
  for (const [key, fn] of getRegistry().entries()) {
    const idx = key.indexOf(':');
    localQueue.registerProcessor(key.slice(0, idx), key.slice(idx + 1), fn);
  }
}

let started = false;
const runningWorkers = [];

async function startWorkers() {
  if (started) return runningWorkers;
  started = true;

  if (!isRedisEnabled()) {
    registerLocalProcessors();
    logger.info('Messaging workers started (in-process mode; no REDIS_URL)');
    return runningWorkers;
  }

  const { Worker } = require('bullmq');
  const connection = getRedisConnection();
  const reg = getRegistry();
  const queueNames = [...new Set([...reg.keys()].map((k) => k.slice(0, k.indexOf(':'))))];

  for (const name of queueNames) {
    const worker = new Worker(
      name,
      async (job) => {
        const fn = reg.get(`${name}:${job.name}`);
        if (!fn) throw new Error(`No handler registered for ${name}:${job.name}`);
        return fn(job.data);
      },
      { connection, concurrency: name === 'broadcast' ? 2 : 5 }
    );

    worker.on('failed', async (job, err) => {
      const attempts = (job.opts && job.opts.attempts) || 1;
      if (job.attemptsMade >= attempts) {
        try {
          await getQueue('dlq').add(job.name, {
            sourceQueue: name,
            data: job.data,
            error: err.message,
            failedAt: Date.now(),
          });
        } catch (e) {
          logger.error({ err: e.message }, 'Failed to write to DLQ');
        }
        logger.error({ queue: name, job: job.name, err: err.message }, 'Job dead-lettered');
      }
    });
    worker.on('error', (e) => logger.error({ queue: name, err: e.message }, 'Worker error'));

    runningWorkers.push(worker);
  }

  logger.info({ queues: queueNames }, 'Messaging workers started (redis mode)');
  return runningWorkers;
}

async function stopWorkers() {
  for (const w of runningWorkers) {
    try { await w.close(); } catch { /* ignore */ }
  }
  runningWorkers.length = 0;
  started = false;
}

module.exports = { registerLocalProcessors, startWorkers, stopWorkers, getRegistry };
