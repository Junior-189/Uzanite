const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Metadata for private objects (payment proofs, receipts, documents) so we can
// enforce tenant ownership and retention.
const storedFileSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    key: { type: String, required: true, unique: true },
    contentType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, default: 0 },
    purpose: { type: String, default: 'general' }, // payment_proof | purchase_receipt | order_receipt | general
    expiresAt: { type: Date, default: null },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true }
);

storedFileSchema.plugin(tenantScopePlugin);
storedFileSchema.index({ businessId: 1, purpose: 1, createdAt: -1 });
storedFileSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('StoredFile', storedFileSchema);
