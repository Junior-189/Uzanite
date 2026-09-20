const mongoose = require('mongoose');

// Per-tenant WhatsApp transport configuration (Phase 2).
// Primary transport is the official Meta Cloud API. Baileys is legacy/gated.
const whatsAppAccountSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, enum: ['meta', 'baileys'], default: 'meta' },
    // Meta identifiers
    phoneNumberId: { type: String, index: { unique: true, sparse: true } },
    wabaId: { type: String, default: '' },
    displayPhoneNumber: { type: String, default: '' },
    // Encrypted at rest (AES-256-GCM via src/utils/crypto).
    accessTokenEnc: { type: String, default: '' },
    // Encrypted verify token. `verifyToken` (plaintext) is retained only so
    // existing rows keep working; new writes populate `verifyTokenEnc` and
    // clear the plaintext column. Both are secrets — storing one encrypted and
    // the other in the clear, side by side, was an inconsistency, not a design.
    verifyTokenEnc: { type: String, default: '' },
    verifyToken: { type: String, default: '' },
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'pending', 'error'],
      default: 'pending',
    },
    qualityRating: { type: String, default: '' },
    lastInboundAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('WhatsAppAccount', whatsAppAccountSchema);
