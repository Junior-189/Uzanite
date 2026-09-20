// Lightweight Prometheus-style metrics (Phase 4).
// Protect with METRICS_TOKEN (header x-metrics-token or ?token=) when set.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const mongoose = require('mongoose');
const { getQueueStats } = require('../queue/queues');
const registry = require('../lib/metrics');

// Constant-time string comparison (avoids leaking the token via timing).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

router.get('/', async (req, res) => {
  const token = process.env.METRICS_TOKEN;
  const isProduction = process.env.NODE_ENV === 'production';
  if (token) {
    const provided = req.headers['x-metrics-token'] || req.query.token;
    if (!provided || !safeEqual(provided, token)) return res.status(403).send('forbidden');
  } else if (isProduction) {
    // Fail closed: metrics leak operational data. Set METRICS_TOKEN in production.
    return res.status(403).send('forbidden');
  }

  const mem = process.memoryUsage();
  const lines = [];
  const metric = (name, help, type, value, labels = '') => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name}${labels} ${value}`);
  };

  metric('uzanite_up', 'Whether the API process is up', 'gauge', 1);
  metric('uzanite_mongodb_ready_state', 'Mongoose connection readyState (1=connected)', 'gauge', mongoose.connection.readyState);
  metric('uzanite_process_uptime_seconds', 'Process uptime in seconds', 'gauge', process.uptime());
  metric('uzanite_process_resident_memory_bytes', 'Resident memory in bytes', 'gauge', mem.rss);

  // Application-level counters/gauges/summaries (requests, orders, payments, …).
  lines.push(registry.render().trimEnd());

  try {
    const stats = await getQueueStats();
    for (const [queue, states] of Object.entries(stats.queues || {})) {
      for (const [state, value] of Object.entries(states)) {
        if (typeof value === 'number') {
          metric('uzanite_queue_jobs', 'Jobs by queue and state', 'gauge', value, `{queue="${queue}",state="${state}"}`);
        }
      }
    }
  } catch {
    /* metrics are best-effort */
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

module.exports = router;
