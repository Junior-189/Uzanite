const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const debtSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: '' },
    dueDate: { type: Date },
    status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    notes: { type: String, default: '' },
    recordedBy: { type: String, default: 'Owner', trim: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

debtSchema.plugin(tenantScopePlugin);
debtSchema.index({ businessId: 1, status: 1 });
debtSchema.index({ businessId: 1, deletedAt: 1 });
debtSchema.index({ businessId: 1, createdAt: -1 });
debtSchema.index({ businessId: 1, _id: -1 });

module.exports = mongoose.model('Debt', debtSchema);
