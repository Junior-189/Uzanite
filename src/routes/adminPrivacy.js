const express = require('express');
const router = express.Router();
const { protect, adminOnly, superAdminOnly, subAdminPermission } = require('../middleware/auth');
const privacyService = require('../services/privacyService');
const User = require('../models/User');
const { sendServerError } = require('../utils/safeError');

router.use(protect, adminOnly);

// GET /api/admin/privacy/tenants/:id/export — export a tenant's data (admin).
router.get('/tenants/:id/export', subAdminPermission('view_tenants'), async (req, res) => {
  try {
    const tenant = await User.findById(req.params.id);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const data = await privacyService.exportTenant(tenant.businessId);
    res.setHeader('Content-Disposition', `attachment; filename="uzanite-export-${tenant.businessId}.json"`);
    res.json(data);
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/admin/privacy/tenants/:id/erase — hard-delete all tenant data (super admin).
router.post('/tenants/:id/erase', superAdminOnly, async (req, res) => {
  try {
    const tenant = await User.findById(req.params.id);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const counts = await privacyService.eraseTenant(tenant.businessId);
    res.json({ success: true, counts });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
