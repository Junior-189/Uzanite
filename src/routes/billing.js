const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const billing = require('../services/billingService');
const { PLANS } = require('../config/plans');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved);

// GET /api/billing/plans — plan catalog.
router.get('/plans', (req, res) => {
  res.json({ success: true, plans: Object.values(PLANS) });
});

// GET /api/billing/status — current plan, status, limits and usage.
router.get('/status', async (req, res) => {
  try {
    const status = await billing.getStatus(req.user);
    res.json({ success: true, billing: status });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
