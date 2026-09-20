const mongoose = require('mongoose');

// Feature flags control which pages/features are enabled for tenants.
// A single global document (scope: 'global') defines the default for every tenant.
// Per-tenant documents (scope: 'tenant', tenantId: <userId>) override the global setting.
const featureFlagSchema = new mongoose.Schema(
  {
    // 'global' or 'tenant'
    scope: { type: String, enum: ['global', 'tenant'], required: true, default: 'global' },
    // tenant user id (only for scope === 'tenant')
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // page/feature key, e.g. 'broadcast', 'reports', 'whatsapp'
    key: { type: String, required: true },
    // whether the feature is enabled
    enabled: { type: Boolean, default: true },
    // admin-written message shown to users when the feature is disabled
    message: { type: String, default: '' },
  },
  { timestamps: true }
);

featureFlagSchema.index({ scope: 1, tenantId: 1, key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('FeatureFlag', featureFlagSchema);
