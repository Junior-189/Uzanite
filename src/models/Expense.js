const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const expenseSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    category: { type: String, default: 'Other' },
    recordedBy: { type: String, default: 'Owner', trim: true },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

expenseSchema.plugin(tenantScopePlugin);
expenseSchema.index({ businessId: 1, date: -1 });
expenseSchema.index({ businessId: 1, _id: -1 });

module.exports = mongoose.model('Expense', expenseSchema);
