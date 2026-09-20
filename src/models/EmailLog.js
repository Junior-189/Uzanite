const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const emailLogSchema = new mongoose.Schema(
  {
    businessId: { type: String, default: 'default' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    recipients: { type: [String], default: [] },
    count: { type: Number, default: 0 },
    channel: { type: String, default: 'email' },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

emailLogSchema.plugin(tenantScopePlugin);
emailLogSchema.index({ businessId: 1, sentAt: -1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
