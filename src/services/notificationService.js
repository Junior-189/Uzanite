const path = require('path');
const fs = require('fs');
const ChatMessage = require('../models/ChatMessage');
const ChatContact = require('../models/ChatContact');
const Business = require('../models/Business');
const { t } = require('../lang');

const toJid = (phone) => {
  if (!phone) return '';
  if (phone.includes('@')) return phone;
  const clean = phone.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
};

// AUDIT FIX (V3): outbound messages are stored against the sending tenant, not
// hardcoded 'default'.
const saveOutboundMessage = async (jid, text, businessId = 'default') => {
  try {
    if (!jid || !text) return;
    const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
    await ChatMessage.create({
      contactPhone: phone,
      jid,
      businessId,
      direction: 'outbound',
      text: text.substring(0, 1000),
    });
  } catch (err) {}
};

const getBusiness = async (businessId = 'default') => {
  try {
    return await Business.findOne({ businessId, deletedAt: { $exists: false } });
  } catch { return null; }
};

const getCustomerLang = async (phone, businessId = 'default') => {
  try {
    const Session = require('../models/Session');
    const clean = (phone || '').replace('@s.whatsapp.net', '').replace('@lid', '');
    const session = await Session.findOne({ phone: clean, businessId });
    return session?.language || 'sw';
  } catch { return 'sw'; }
};

/**
 * Check if we can send a free-form message to a contact (within 24h window + opted in)
 * Returns: { canSend: boolean, reason?: string }
 */
const canSendFreeForm = async (phone, businessId = 'default') => {
  const contact = await ChatContact.findOne({ 
    phone: phone.replace('@s.whatsapp.net', '').replace('@lid', ''), 
    businessId 
  });
  
  if (!contact) return { canSend: false, reason: 'Contact not found' };
  if (!contact.optIn) return { canSend: false, reason: 'User opted out' };
  if (contact.unsubscribedAt) return { canSend: false, reason: 'User unsubscribed' };
  
  const hoursSinceLastMessage = contact.lastMessageAt 
    ? (Date.now() - contact.lastMessageAt.getTime()) / (1000 * 60 * 60)
    : Infinity;
  
  if (hoursSinceLastMessage > 24) {
    return { canSend: false, reason: `Outside 24h window (${hoursSinceLastMessage.toFixed(1)}h ago)` };
  }
  
  return { canSend: true };
};

const adminJid = async (businessId = 'default') => {
  const business = await getBusiness(businessId);
  return toJid(business?.phone || '');
};

/**
 * Send free-form message if within 24h window, otherwise log for template delivery
 */
const sendCustomerMessage = async (sock, phone, msg, lang, businessId = 'default') => {
  const jid = toJid(phone);
  const check = await canSendFreeForm(phone, businessId);
  
  if (check.canSend) {
    await sock.sendMessage(jid, { text: msg });
    saveOutboundMessage(jid, msg, businessId);
    return { sent: true, method: 'freeform' };
  } else {
    // Log for template delivery later
    console.log(`⚠️  Cannot send free-form to ${phone}: ${check.reason}. Queue for template.`);
    return { sent: false, reason: check.reason, jid, msg, lang };
  }
};

const notifyAdminNewOrder = async (sock, order) => {
  const items = order.items
    .map((i) => t('notify.admin_item_line', 'sw', { name: i.productName, qty: i.quantity, currency: i.currency, subtotal: i.subtotal.toLocaleString() }))
    .join('\n');

  const locationLine = order.deliveryLocation
    ? t('notify.admin_location_line', 'sw', { location: order.deliveryLocation })
    : '';

  const contactLine = order.deliveryPhone
    ? t('notify.admin_contact_line', 'sw', { phone: order.deliveryPhone })
    : '';

  const msg = t('notify.admin_new_order', 'sw', {
    orderNumber: order.orderNumber,
    customer: order.customerName,
    phone: order.customerPhone.replace('@s.whatsapp.net', ''),
    locationLine,
    contactLine,
    items,
    currency: order.currency,
    total: order.total.toLocaleString(),
  });

  await sock.sendMessage(await adminJid(order.businessId), { text: msg });
};

const notifyAdminPaymentProof = async (sock, order, proofNote) => {
  const msg = t('notify.admin_payment_proof', 'sw', {
    orderNumber: order.orderNumber,
    customer: order.customerName,
    currency: order.currency,
    total: order.total.toLocaleString(),
    ref: proofNote,
  });

  await sock.sendMessage(await adminJid(order.businessId), { text: msg });
};

const notifyCustomerOrderReceived = async (sock, order, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(order.customerPhone, businessId);
  const msg = t('notify.customer_order_received', lang, {
    orderNumber: order.orderNumber,
    currency: order.currency,
    total: order.total.toLocaleString(),
  });

  const result = await sendCustomerMessage(sock, order.customerPhone, msg, lang, businessId);

  // Queue receipt (WhatsApp document + email) as a background job.
  try {
    const { enqueue } = require('../queue/queues');
    await enqueue('receipts', 'send', { businessId, orderId: order._id, mode: 'document' });
  } catch (err) {
    console.error('Failed to enqueue receipt:', err.message);
  }

  return result;
};

const notifyCustomerOrderApproved = async (sock, order, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(order.customerPhone, businessId);
  const business = await getBusiness(businessId);
  const businessName = business?.name || 'Our Shop';

  const paymentInfo = t('notify.payment_info', lang, {
    mpesaNumber: business?.payment?.mpesa?.number || t('notify.payment_na', lang),
    mpesaName: business?.payment?.mpesa?.name || '',
    tigoNumber: business?.payment?.tigo?.number || t('notify.payment_na', lang),
    airtelNumber: business?.payment?.airtel?.number || t('notify.payment_na', lang),
  });

  const msg = t('notify.customer_order_approved', lang, {
    customer: order.customerName,
    orderNumber: order.orderNumber,
    businessName,
    currency: order.currency,
    total: order.total.toLocaleString(),
    paymentInfo,
  });

  return sendCustomerMessage(sock, order.customerPhone, msg, lang, businessId);
};

const notifyCustomerOrderRejected = async (sock, order, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(order.customerPhone, businessId);
  const reason = order.rejectionReason
    ? t('notify.customer_rejection_reason', lang, { reason: order.rejectionReason })
    : '\n';

  const msg = t('notify.customer_order_rejected', lang, {
    orderNumber: order.orderNumber,
    reason,
  });

  return sendCustomerMessage(sock, order.customerPhone, msg, lang, businessId);
};

const notifyCustomerPaymentConfirmed = async (sock, order, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(order.customerPhone, businessId);
  const msg = t('notify.customer_payment_confirmed', lang, {
    orderNumber: order.orderNumber,
  });

  const result = await sendCustomerMessage(sock, order.customerPhone, msg, lang, businessId);

  // Queue receipt (WhatsApp image + email) as a background job.
  try {
    const { enqueue } = require('../queue/queues');
    await enqueue('receipts', 'send', { businessId, orderId: order._id, mode: 'image' });
  } catch (err) {
    console.error('Failed to enqueue receipt:', err.message);
  }

  return result;
};

const notifyCustomerDelivered = async (sock, order, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(order.customerPhone, businessId);
  const note = order.deliveryNote
    ? t('notify.customer_delivery_note', lang, { note: order.deliveryNote })
    : '\n';

  const msg = t('notify.customer_delivered', lang, {
    orderNumber: order.orderNumber,
    note,
  });

  return sendCustomerMessage(sock, order.customerPhone, msg, lang, businessId);
};

const notifyCustomerBackInStock = async (sock, customerPhone, productName, lang, businessId = 'default') => {
  if (!lang) lang = await getCustomerLang(customerPhone, businessId);
  const msg = t('notify.customer_back_in_stock', lang, { productName });

  try {
    return await sendCustomerMessage(sock, customerPhone, msg, lang, businessId);
  } catch (err) {
    console.error(`Failed to notify ${customerPhone} about ${productName}:`, err.message);
    return { sent: false, reason: err.message };
  }
};

module.exports = {
  toJid,
  adminJid,
  notifyAdminNewOrder,
  notifyAdminPaymentProof,
  notifyCustomerOrderReceived,
  notifyCustomerOrderApproved,
  notifyCustomerOrderRejected,
  notifyCustomerPaymentConfirmed,
  notifyCustomerDelivered,
  notifyCustomerBackInStock,
};
