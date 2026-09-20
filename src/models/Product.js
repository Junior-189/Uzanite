const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const productSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    clientRef: { type: String, index: true }, // client-generated id for idempotent sync
    name: { type: String, required: true, trim: true },
    barcode: { type: String, default: null },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    minPrice: { type: Number, default: 0, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'TZS' },
    stock: { type: Number, required: true, min: 0, default: 0 },
    lastRestockedAt: { type: Date, default: null },
    imagePath: { type: String, default: null },
    recordedBy: { type: String, default: 'Owner', trim: true },
    expiryDate: { type: Date, default: null },
    expiryNotified: { type: String, default: null, enum: [null, 'near', 'expired'] },
    lowStockThreshold: { type: Number, default: 5 },
    expiryWarnDays: { type: Number, default: 7, min: 0 },
    active: { type: Boolean, default: true },
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

productSchema.virtual('formattedPrice').get(function () {
  return `${this.currency} ${this.price.toLocaleString()}`;
});

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.lowStockThreshold;
});

productSchema.virtual('isOutOfStock').get(function () {
  return this.stock <= 0;
});

// Tenant isolation + query indexes (Phase 1).
productSchema.plugin(tenantScopePlugin);
productSchema.index({ businessId: 1, active: 1, deletedAt: 1 });
productSchema.index({ businessId: 1, active: 1, deletedAt: 1, _id: -1 });
productSchema.index({ businessId: 1, name: 1 });
// Barcode is unique per tenant (only when present).
productSchema.index(
  { businessId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } }
);

module.exports = mongoose.model('Product', productSchema);
