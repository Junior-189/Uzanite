const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { getQueueStats, getDeadLetters, isRedisEnabled } = require('../queue/queues');
const { sendServerError } = require('../utils/safeError');

router.use(protect, adminOnly);

// GET /api/admin/queues — queue depth + failed counts (operator observability).
router.get('/', async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json({ success: true, redis: isRedisEnabled(), ...stats });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/admin/queues/dead-letters — recent dead-lettered jobs.
router.get('/dead-letters', async (req, res) => {
  try {
    const items = await getDeadLetters(50);
    res.json({ success: true, count: items.length, items });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
