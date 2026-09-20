const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Append-only stock movement ledger. Every change to a product's stock is
// recorded with the resulting balance so inventory is fully auditable.
const stockMovementSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, default: '' },
    quantity: { type: Number, required: true }, // signed: negative = out, positive = in
    balanceAfter: { type: Number, default: null },
    reason: {
      type: String,
      enum: [
        'order_created',
        'order_rejected',
        'order_deleted',
        'order_restored',
        'restock',
        'manual_adjust',
      ],
      required: true,
    },
    refType: { type: String, default: '' },
    refId: { type: String, default: '' },
    dedupeKey: { type: String, default: null },
    recordedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

stockMovementSchema.plugin(tenantScopePlugin);
stockMovementSchema.index({ businessId: 1, productId: 1, createdAt: -1 });
stockMovementSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('StockMovement', stockMovementSchema);
