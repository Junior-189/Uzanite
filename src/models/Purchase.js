const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const purchaseSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    costPerUnit: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    supplier: { type: String, default: '' },
    recordedBy: { type: String, default: 'Owner', trim: true },
    expiryDate: { type: Date, default: null },
    expiryNotified: { type: String, default: null, enum: [null, 'near', 'expired'] },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
    receiptPath: { type: String, default: '' },
    clientRef: { type: String, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

purchaseSchema.plugin(tenantScopePlugin);
purchaseSchema.index({ businessId: 1, date: -1 });
purchaseSchema.index({ businessId: 1, productId: 1 });
purchaseSchema.index({ businessId: 1, clientRef: 1 }, { sparse: true });
purchaseSchema.index({ businessId: 1, deletedAt: 1 });
purchaseSchema.index({ businessId: 1, _id: -1 });

module.exports = mongoose.model('Purchase', purchaseSchema);
