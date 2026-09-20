const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const stockNotificationSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    customerPhone: { type: String, required: true }, // JID format: 255xxx@s.whatsapp.net
    notified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Ensure one request per product per customer per tenant.
stockNotificationSchema.plugin(tenantScopePlugin);
stockNotificationSchema.index({ businessId: 1, productId: 1, customerPhone: 1 }, { unique: true });

module.exports = mongoose.model('StockNotification', stockNotificationSchema);