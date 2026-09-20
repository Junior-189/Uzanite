const Notification = require('../models/Notification');

const TYPE_LABELS = {
  order_created: 'New Order',
  order_approved: 'Order Approved',
  order_rejected: 'Order Rejected',
  order_paid: 'Order Paid',
  order_delivered: 'Order Delivered',
  payment_received: 'Payment Received',
  payment_confirmed: 'Payment Confirmed',
  payment_failed: 'Payment Failed',
  low_stock: 'Low Stock Alert',
  out_of_stock: 'Out of Stock',
  back_in_stock: 'Back in Stock',
  broadcast_sent: 'Broadcast Sent',
  broadcast_failed: 'Broadcast Failed',
  new_contact: 'New Contact',
  contact_opted_out: 'Contact Opted Out',
  whatsapp_connected: 'WhatsApp Connected',
  whatsapp_disconnected: 'WhatsApp Disconnected',
  system_error: 'System Error',
  custom: 'Notification',
};

const PRIORITY_COLORS = {
  low: '#6c757d',
  normal: '#17a2b8',
  high: '#ffc107',
  critical: '#dc3545',
};

const createNotification = async ({ businessId, type, title, message, data = {}, priority = 'normal' }) => {
  try {
    const notif = await Notification.create({
      businessId,
      type,
      title: title || TYPE_LABELS[type] || 'Notification',
      message,
      data,
      priority,
    });
    return notif;
  } catch (err) {
    console.error('Failed to create notification:', err.message);
    return null;
  }
};

const getNotifications = async (businessId, { limit = 50, skip = 0, unreadOnly = false } = {}) => {
  const filter = { businessId, deletedAt: null };
  if (unreadOnly) filter.read = false;
  return Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
};

const getUnreadCount = async (businessId) => {
  return Notification.countDocuments({ businessId, read: false, deletedAt: null });
};

const markAsRead = async (notificationId, businessId) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, businessId },
    { read: true, readAt: new Date() },
    { new: true }
  );
};

const markAllAsRead = async (businessId) => {
  return Notification.updateMany(
    { businessId, read: false, deletedAt: null },
    { read: true, readAt: new Date() }
  );
};

const deleteNotification = async (notificationId, businessId, deletedBy = null) => {
  return Notification.findOneAndUpdate(
    { _id: notificationId, businessId, deletedAt: null },
    { deletedAt: new Date(), deletedBy },
    { new: true }
  );
};

const deleteAllNotifications = async (businessId, deletedBy = null) => {
  return Notification.updateMany(
    { businessId, deletedAt: null },
    { deletedAt: new Date(), deletedBy }
  );
};

module.exports = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  TYPE_LABELS,
  PRIORITY_COLORS,
};