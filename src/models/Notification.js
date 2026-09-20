const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

const notificationSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    type: { 
      type: String, 
      enum: [
        'order_created', 'order_approved', 'order_rejected', 'order_paid', 'order_delivered',
        'payment_received', 'payment_confirmed', 'payment_failed',
        'low_stock', 'out_of_stock', 'back_in_stock',
        'broadcast_sent', 'broadcast_failed',
        'new_contact', 'contact_opted_out',
        'whatsapp_connected', 'whatsapp_disconnected',
        'account_approved', 'account_rejected',
        'debt_reminder',
        'system_error', 'custom'
      ],
      required: true 
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Object, default: {} }, // orderId, productId, broadcastId, etc.
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    priority: { type: String, enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

notificationSchema.plugin(tenantScopePlugin);
notificationSchema.index({ businessId: 1, createdAt: -1 });
notificationSchema.index({ businessId: 1, read: 1 });
notificationSchema.index({ businessId: 1, deletedAt: 1, _id: -1 });

module.exports = mongoose.model('Notification', notificationSchema);