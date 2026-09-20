const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const analyticsService = require('../services/analyticsService');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('reports'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/analytics?period=daily|weekly|monthly|annually|all|alltime
router.get('/', async (req, res) => {
  try {
    const data = await analyticsService.dashboard(getBusinessId(req), req.query.period || 'alltime');
    res.json({ success: true, ...data });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
