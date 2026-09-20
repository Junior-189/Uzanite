const mongoose = require('mongoose');

// Inbound webhook event ledger: deduplicates Meta retries and enables replay.
const webhookEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    provider: { type: String, default: 'meta' },
    businessId: { type: String, default: '' },
    type: { type: String, default: 'unknown' }, // message | status
    payload: { type: Object, default: {} },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Retain events for 30 days for dedupe/replay.
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
