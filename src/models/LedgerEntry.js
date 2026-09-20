const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Append-only financial ledger. Every money movement (payment, cash sale,
// refund) creates exactly one entry, keyed for idempotency by
// (businessId, type, refType, refId).
const ledgerEntrySchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    type: {
      type: String,
      enum: ['payment_in', 'cash_sale', 'refund', 'adjustment'],
      required: true,
    },
    direction: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'TZS' },
    refType: { type: String, default: '' },
    refId: { type: String, default: '' },
    description: { type: String, default: '' },
    meta: { type: Object, default: {} },
    recordedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

ledgerEntrySchema.plugin(tenantScopePlugin);
ledgerEntrySchema.index({ businessId: 1, createdAt: -1 });
ledgerEntrySchema.index({ businessId: 1, _id: -1 });
ledgerEntrySchema.index(
  { businessId: 1, type: 1, refType: 1, refId: 1 },
  { unique: true, partialFilterExpression: { refId: { $type: 'string' } } }
);

// Append-only: block in-place updates entirely.
ledgerEntrySchema.pre('findOneAndUpdate', function block(next) {
  next(new Error('LedgerEntry is append-only'));
});
ledgerEntrySchema.pre('updateOne', function block(next) {
  next(new Error('LedgerEntry is append-only'));
});
ledgerEntrySchema.pre('updateMany', function block(next) {
  next(new Error('LedgerEntry is append-only'));
});

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
