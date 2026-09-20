const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const chatMessageSchema = new mongoose.Schema(
  {
    contactPhone: { type: String, required: true },
    jid: { type: String, default: '' },
    businessId: { type: String, default: 'default' },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    text: { type: String, default: '' },
    messageType: { type: String, default: 'text' },
    // Meta delivery tracking (Phase 2).
    providerMessageId: { type: String, default: '' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed', ''],
      default: '',
    },
    statusUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chatMessageSchema.plugin(tenantScopePlugin);
chatMessageSchema.index({ businessId: 1, contactPhone: 1, createdAt: -1 });
chatMessageSchema.index({ businessId: 1, providerMessageId: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);