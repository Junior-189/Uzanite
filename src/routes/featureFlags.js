const express = require('express');
const router = express.Router();
const FeatureFlag = require('../models/FeatureFlag');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { sendServerError } = require('../utils/safeError');
const {
  FEATURE_KEYS,
  ensureGlobalFlags,
  getEffectiveFlags,
  invalidateFlagsCache,
} = require('../services/featureFlagService');

// Tenant endpoint: return the current tenant's own effective feature flags.
router.get('/me', protect, async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.json({ success: true, flags: {} });
    }
    const flags = await getEffectiveFlags(req.user._id);
    res.json({ success: true, flags });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// All routes below require admin auth.
router.use(protect, adminOnly);

// GET /api/admin/feature-flags — global flags + optional tenant overrides.
router.get('/feature-flags', async (req, res) => {
  try {
    const { tenantId } = req.query;
    const globalFlags = await FeatureFlag.find({ scope: 'global', tenantId: null });

    if (!tenantId) {
      return res.json({
        success: true,
        features: FEATURE_KEYS,
        global: globalFlags.reduce((acc, f) => {
          acc[f.key] = { enabled: f.enabled, message: f.message };
          return acc;
        }, {}),
      });
    }

    const tenant = await User.findById(tenantId);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const overrides = await FeatureFlag.find({ scope: 'tenant', tenantId });

    const merged = globalFlags.reduce((acc, f) => {
      const ov = overrides.find((o) => o.key === f.key);
      acc[f.key] = {
        enabled: ov ? ov.enabled : f.enabled,
        message: ov ? ov.message : f.message,
        overridden: !!ov,
      };
      return acc;
    }, {});

    res.json({ success: true, features: FEATURE_KEYS, global: merged });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/feature-flags — update global flags.
router.put('/feature-flags', async (req, res) => {
  try {
    await ensureGlobalFlags();
    const flags = req.body && req.body.flags;
    if (!flags || typeof flags !== 'object') {
      return res.status(400).json({ success: false, error: 'flags object required' });
    }
    for (const { key } of FEATURE_KEYS) {
      if (flags[key]) {
        await FeatureFlag.findOneAndUpdate(
          { scope: 'global', tenantId: null, key },
          { enabled: flags[key].enabled !== false, message: flags[key].message || '' },
          { upsert: true }
        );
      }
    }
    invalidateFlagsCache();
    const globalFlags = await FeatureFlag.find({ scope: 'global', tenantId: null });
    res.json({
      success: true,
      message: 'Feature flags updated',
      global: globalFlags.reduce((acc, f) => {
        acc[f.key] = { enabled: f.enabled, message: f.message };
        return acc;
      }, {}),
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/feature-flags/:tenantId — update a single tenant's overrides.
router.put('/feature-flags/:tenantId', async (req, res) => {
  try {
    const tenant = await User.findById(req.params.tenantId);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const flags = req.body && req.body.flags;
    if (!flags || typeof flags !== 'object') {
      return res.status(400).json({ success: false, error: 'flags object required' });
    }
    for (const { key } of FEATURE_KEYS) {
      if (flags[key]) {
        await FeatureFlag.findOneAndUpdate(
          { scope: 'tenant', tenantId: tenant._id, key },
          { enabled: flags[key].enabled !== false, message: flags[key].message || '' },
          { upsert: true }
        );
      }
    }
    invalidateFlagsCache();
    const overrides = await FeatureFlag.find({ scope: 'tenant', tenantId: tenant._id });
    res.json({
      success: true,
      message: 'Tenant feature flags updated',
      overrides: overrides.reduce((acc, f) => {
        acc[f.key] = { enabled: f.enabled, message: f.message };
        return acc;
      }, {}),
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/admin/feature-flags/:tenantId — clear a tenant's overrides.
router.delete('/feature-flags/:tenantId', async (req, res) => {
  try {
    const tenant = await User.findById(req.params.tenantId);
    if (!tenant || tenant.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    await FeatureFlag.deleteMany({ scope: 'tenant', tenantId: tenant._id });
    invalidateFlagsCache();
    res.json({ success: true, message: 'Tenant feature flags reset to global defaults' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
module.exports.ensureGlobalFlags = ensureGlobalFlags;
module.exports.getEffectiveFlags = getEffectiveFlags;
module.exports.FEATURE_KEYS = FEATURE_KEYS;
