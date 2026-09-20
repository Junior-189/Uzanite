const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Per-tenant, per-metric, per-period usage counters (e.g. broadcasts/month).
const usageCounterSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    metric: { type: String, required: true },
    periodKey: { type: String, required: true }, // e.g. 2026-09
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

usageCounterSchema.plugin(tenantScopePlugin);
usageCounterSchema.index({ businessId: 1, metric: 1, periodKey: 1 }, { unique: true });

module.exports = mongoose.model('UsageCounter', usageCounterSchema);
