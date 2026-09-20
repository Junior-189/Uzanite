const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// PDPA consent ledger: records when a data subject grants/revokes marketing
// consent (or is imported pending consent).
const consentLogSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    channel: { type: String, enum: ['whatsapp', 'email', 'sms', 'any'], default: 'any' },
    action: { type: String, enum: ['granted', 'revoked', 'imported'], required: true },
    source: { type: String, default: '' }, // e.g. whatsapp_keyword, import, manual, api
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

consentLogSchema.plugin(tenantScopePlugin);
consentLogSchema.index({ businessId: 1, phone: 1, createdAt: -1 });
consentLogSchema.index({ businessId: 1, email: 1, createdAt: -1 });

module.exports = mongoose.model('ConsentLog', consentLogSchema);
