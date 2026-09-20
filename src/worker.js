// Dedicated messaging worker entrypoint (run as a separate process when
// scaling out). Requires Redis; otherwise prefer the in-process fallback which
// server.js starts automatically.
require('dotenv').config();
require('./config/env');
const connectDB = require('./config/database');
const { startWorkers, stopWorkers } = require('./queue/worker');
const logger = require('./config/logger');

const start = async () => {
  await connectDB();
  await startWorkers();
  logger.info('UZANITE worker process ready');
};

const shutdown = async (signal) => {
  logger.info({ signal }, 'Worker shutting down');
  await stopWorkers();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error({ err: err.message }, 'Worker failed to start');
  process.exit(1);
});
