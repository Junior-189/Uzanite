const { isFeatureEnabled } = require('../services/featureFlagService');

// Blocks a request when the tenant's feature flag for `key` is disabled.
// Super-admins/sub-admins bypass. Closes audit finding V19 (client-only flags).
function requireFeature(key) {
  return async (req, res, next) => {
    try {
      const enabled = await isFeatureEnabled(req.user, key);
      if (!enabled) {
        return res.status(403).json({ success: false, error: 'This feature is disabled for your account.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireFeature };
