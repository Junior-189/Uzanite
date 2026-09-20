const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const chatContactSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    jid: { type: String, default: '' },
    email: { type: String, default: '' },
    name: { type: String, default: '' },
    businessId: { type: String, default: 'default' },
    messageCount: { type: Number, default: 1 },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessage: { type: String, default: '' },
    isNotified: { type: Boolean, default: false },
    // WhatsApp policy compliance
    optIn: { type: Boolean, default: true },
    optInAt: { type: Date, default: Date.now },
    unsubscribedAt: { type: Date, default: null },
    // PDPA consent status (Phase 3): granted | pending | revoked
    consentStatus: {
      type: String,
      enum: ['granted', 'pending', 'revoked'],
      default: 'granted',
    },
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Phase 1: phone is unique per tenant (not globally).
chatContactSchema.plugin(tenantScopePlugin);
chatContactSchema.index({ businessId: 1, phone: 1 }, { unique: true });
chatContactSchema.index({ businessId: 1, lastMessageAt: -1 });
chatContactSchema.index({ businessId: 1, _id: -1 });

module.exports = mongoose.model('ChatContact', chatContactSchema);