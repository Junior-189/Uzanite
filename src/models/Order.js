const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');
const { generateOrderNumber } = require('../services/counterService');

// Order status lifecycle:
// PENDING → APPROVED → PENDING_PAYMENT → PAID → DELIVERED
//         ↘ REJECTED

const ORDER_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  DELIVERED: 'DELIVERED',
};

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productName: { type: String, required: true },
    price: { type: Number, required: true },
    currency: { type: String, default: 'TZS' },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    orderNumber: { type: String }, // auto-generated (unique per tenant)
    clientRef: { type: String, index: true }, // client-generated id for idempotent sync
    customerPhone: { type: String, default: '' },
    customerName: { type: String, default: 'Customer' },
    customerEmail: { type: String, default: '' },
    deliveryLocation: { type: String, default: '' },
    deliveryPhone: { type: String, default: '' },
    source: { type: String, enum: ['whatsapp', 'cash'], default: 'whatsapp' },
    recordedBy: { type: String, default: '' },
    items: [orderItemSchema],
    total: { type: Number, required: true },
    originalTotal: { type: Number }, // before negotiation
    offeredTotal: { type: Number }, // customer's offered price
    currency: { type: String, default: 'TZS' },
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PENDING,
    },
    // Admin actions
    adminNote: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    // Payment
    paymentMethod: { type: String, default: '' },
    paymentReference: { type: String, default: '' }, // customer-provided ref
    paymentProofPath: { type: String, default: null }, // screenshot if sent
    paymentConfirmedAt: { type: Date, default: null },
    // Delivery
    deliveryNote: { type: String, default: '' },
    deliveredAt: { type: Date, default: null },
    // Timestamps for each status transition
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        note: String,
      },
    ],
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Race-free order number via an atomic per-tenant-per-day counter.
orderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    try {
      this.orderNumber = await generateOrderNumber(this.businessId);
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Push to statusHistory whenever status changes
orderSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.statusHistory.push({ status: this.status, changedAt: new Date() });
  }
  next();
});

// Tenant isolation + query indexes (Phase 1).
orderSchema.plugin(tenantScopePlugin);
orderSchema.index({ businessId: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ businessId: 1, status: 1, createdAt: -1 });
orderSchema.index({ businessId: 1, customerPhone: 1, createdAt: -1 });
orderSchema.index({ businessId: 1, deletedAt: 1 });
// Keyset pagination (sort by _id within a tenant).
orderSchema.index({ businessId: 1, deletedAt: 1, _id: -1 });
// Idempotent offline/manual order creation.
orderSchema.index(
  { businessId: 1, clientRef: 1 },
  { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } }
);

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUS = ORDER_STATUS;
