const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Tracks where each customer is in the bot conversation flow
// Composite index ensures each customer has separate session per tenant
const sessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    businessId: { type: String, required: true, default: 'default' },
    name: { type: String, default: '' },
    // Current step in the conversation state machine
    step: { type: String, default: 'MAIN_MENU' },
    // Temporary cart: array of { productId, productName, price, quantity, subtotal }
    cart: { type: Array, default: [] },
    // Customer language preference (sw = Swahili, en = English)
    language: { type: String },
    // Temporary data during multi-step flows (e.g. which product being discussed)
    context: { type: Object, default: {} },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ── CRITICAL: Composite unique index ensures tenant isolation ──
// Each phone number can have ONE session per businessId
sessionSchema.index({ phone: 1, businessId: 1 }, { unique: true });

// Expire sessions after 2 hours of inactivity (auto-cleaned by MongoDB TTL index)
sessionSchema.index({ lastActivity: 1 }, { expireAfterSeconds: 7200 });

sessionSchema.plugin(tenantScopePlugin);

module.exports = mongoose.model('Session', sessionSchema);
