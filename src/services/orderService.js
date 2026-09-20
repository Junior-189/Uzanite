const Order = require('../models/Order');
const Product = require('../models/Product');
const { ORDER_STATUS } = require('../models/Order');
const { createNotification } = require('./notificationStore');
const { withTransaction } = require('../db/transaction');
const { generateOrderNumber } = require('./counterService');
const { recordStockMovement, recordLedger } = require('./ledgerService');
const Payment = require('../models/Payment');
const metrics = require('../lib/metrics');

// Atomically decrements stock for each item, refusing to oversell, and writes an
// immutable StockMovement per item. Low/out-of-stock notifications are deferred
// to `postCommit` so they only fire if the surrounding transaction commits.
async function deductStock(items, businessId, session, postCommit, ctx = {}) {
  const reason = ctx.reason || 'order_created';
  const refType = ctx.refType || 'order';
  const refId = ctx.refId || '';
  for (const item of items) {
    if (!item.productId) continue;
    const updated = await Product.findOneAndUpdate(
      { _id: item.productId, stock: { $gte: item.quantity } },
      { $inc: { stock: -item.quantity } },
      { new: true, session }
    );
    if (!updated) {
      const p = await Product.findById(item.productId).session(session || null).lean();
      throw new Error(`${p ? p.name : 'Product'}: Insufficient stock (requested: ${item.quantity})`);
    }
    await recordStockMovement({
      businessId,
      productId: updated._id,
      productName: updated.name,
      quantity: -item.quantity,
      balanceAfter: updated.stock,
      reason,
      refType,
      refId,
      dedupeKey: refId ? `${refType}:${refId}:${updated._id}:${reason}` : null,
      recordedBy: ctx.recordedBy || '',
      session,
    });
    if (updated.stock === 0) {
      postCommit.push(() =>
        createNotification({ businessId, type: 'out_of_stock', title: 'Out of Stock', message: `${updated.name} is now out of stock`, data: { productId: updated._id.toString() }, priority: 'critical' })
      );
    } else if (updated.stock <= updated.lowStockThreshold) {
      postCommit.push(() =>
        createNotification({ businessId, type: 'low_stock', title: 'Low Stock Alert', message: `${updated.name} has only ${updated.stock} left (threshold: ${updated.lowStockThreshold})`, data: { productId: updated._id.toString() }, priority: 'high' })
      );
    }
  }
}

// Restores stock for an order's items and writes the corresponding movements.
async function restoreStock(items, businessId, session, ctx = {}) {
  const reason = ctx.reason || 'order_rejected';
  const refType = ctx.refType || 'order';
  const refId = ctx.refId || '';
  for (const item of items) {
    if (!item.productId) continue;
    const updated = await Product.findByIdAndUpdate(
      item.productId,
      { $inc: { stock: item.quantity } },
      { new: true, session }
    );
    if (updated) {
      await recordStockMovement({
        businessId,
        productId: updated._id,
        productName: updated.name,
        quantity: item.quantity,
        balanceAfter: updated.stock,
        reason,
        refType,
        refId,
        dedupeKey: refId ? `${refType}:${refId}:${updated._id}:${reason}` : null,
        recordedBy: ctx.recordedBy || '',
        session,
      });
    }
  }
}

const createOrder = async ({ businessId, customerPhone, customerName, deliveryLocation, deliveryPhone, items, offeredTotal }) => {
  const calculatedTotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const total = offeredTotal !== undefined ? offeredTotal : calculatedTotal;
  const currency = items[0]?.currency || 'TZS';
  const orderNumber = await generateOrderNumber(businessId);
  const postCommit = [];

  const order = await withTransaction(async (session) => {
    const orderData = {
      businessId,
      orderNumber,
      customerPhone,
      customerName,
      deliveryLocation: deliveryLocation || '',
      deliveryPhone: deliveryPhone || '',
      items,
      total,
      currency,
      status: ORDER_STATUS.PENDING,
      source: 'whatsapp',
    };
    if (offeredTotal !== undefined) {
      orderData.offeredTotal = offeredTotal;
      orderData.originalTotal = calculatedTotal;
    }
    const [created] = await Order.create([orderData], { session });
    // Deduct stock after the order exists so movements can reference its id.
    await deductStock(items, businessId, session, postCommit, {
      reason: 'order_created',
      refType: 'order',
      refId: String(created._id),
      recordedBy: customerName || '',
    });
    return created;
  });

  postCommit.forEach((fn) => { try { fn(); } catch (_) {} });
  metrics.inc('uzanite_orders_created_total', { source: 'whatsapp' });
  return order;
};

const createManualOrder = async ({ businessId, customerName, customerPhone, customerEmail, items, recordedBy = '', clientRef }) => {
  // Idempotency: if the client already created this order (e.g. retried after a
  // lost response or offline sync), return the existing order instead of
  // deducting stock again and creating a duplicate.
  if (clientRef) {
    const existing = await Order.findOne({ clientRef, businessId, deletedAt: null });
    if (existing) return existing;
  }

  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const currency = items[0]?.currency || 'TZS';

  // Resolve a customer email: prefer the provided one, else fall back to the
  // contact's stored email (so receipt emails work even if the cashier omitted it).
  let resolvedEmail = (customerEmail || '').toString().trim();
  if (!resolvedEmail && customerPhone) {
    try {
      const ChatContact = require('../models/ChatContact');
      const contact = await ChatContact.findOne({
        phone: String(customerPhone).replace('@s.whatsapp.net', ''),
        businessId,
      }).lean();
      if (contact?.email) resolvedEmail = contact.email;
    } catch (_) {}
  }

  const orderNumber = await generateOrderNumber(businessId);
  const postCommit = [];

  let order;
  try {
    order = await withTransaction(async (session) => {
      const [created] = await Order.create(
        [{
          businessId,
          orderNumber,
          customerName,
          customerPhone: customerPhone || '',
          customerEmail: resolvedEmail,
          items,
          total,
          currency,
          status: ORDER_STATUS.PAID,
          paymentMethod: 'Cash',
          paymentReference: 'Walk-in Cash',
          paymentConfirmedAt: new Date(),
          deliveredAt: new Date(),
          source: 'cash',
          recordedBy,
          clientRef: clientRef || undefined,
        }],
        { session }
      );
      await deductStock(items, businessId, session, postCommit, {
        reason: 'order_created',
        refType: 'order',
        refId: String(created._id),
        recordedBy,
      });
      // Unified ledger: cash sales and WhatsApp orders land in the same ledger.
      await recordLedger({
        businessId,
        type: 'cash_sale',
        direction: 'credit',
        amount: total,
        currency,
        refType: 'order',
        refId: String(created._id),
        description: 'Walk-in cash sale',
        meta: { source: 'cash' },
        recordedBy,
        session,
      });
      await Payment.create(
        [{
          businessId,
          orderId: created._id,
          provider: 'manual',
          method: 'cash',
          providerRef: `cash-${created._id}`,
          amount: total,
          currency,
          phone: customerPhone || '',
          status: 'succeeded',
          confirmedAt: new Date(),
          initiatedBy: recordedBy,
        }],
        { session }
      );
      return created;
    });
  } catch (err) {
    // Concurrent duplicate clientRef: return the winner instead of erroring.
    if (clientRef && err && err.code === 11000) {
      const existing = await Order.findOne({ clientRef, businessId, deletedAt: null });
      if (existing) return existing;
    }
    throw err;
  }

  postCommit.forEach((fn) => { try { fn(); } catch (_) {} });
  metrics.inc('uzanite_orders_created_total', { source: 'cash' });
  return order;
};

const getOrdersByBusiness = async (businessId = 'default', status = null) => {
  const query = { businessId, deletedAt: null };
  if (status) query.status = status;
  return Order.find(query).sort({ createdAt: -1 });
};

// AUDIT FIX (V3): tenant-scoped. Callers must pass businessId so a customer
// can never enumerate another tenant's orders.
const getOrdersByCustomer = async (customerPhone, businessId) => {
  const query = { customerPhone, deletedAt: null };
  if (businessId) query.businessId = businessId;
  return Order.find(query).sort({ createdAt: -1 });
};

const getOrderById = async (id) => Order.findOne({ _id: id, deletedAt: null });

const getOrderByNumber = async (orderNumber, businessId = null) => {
  const query = { orderNumber, deletedAt: null };
  if (businessId) query.businessId = businessId;
  return Order.findOne(query);
};

const approveOrder = async (orderId, note = '') => {
  return Order.findByIdAndUpdate(
    orderId,
    { status: ORDER_STATUS.APPROVED, adminNote: note },
    { new: true }
  );
};

const rejectOrder = async (orderId, reason = '') => {
  const postCommit = [];

  const order = await withTransaction(async (session) => {
    // Atomic transition guard: only reject (and restore stock) once.
    const rejected = await Order.findOneAndUpdate(
      { _id: orderId, status: { $ne: ORDER_STATUS.REJECTED } },
      { status: ORDER_STATUS.REJECTED, rejectionReason: reason },
      { new: true, session }
    );
    if (!rejected) {
      // Not found, or already rejected — return current state unchanged.
      return Order.findById(orderId).session(session || null);
    }

    for (const item of rejected.items) {
      if (!item.productId) continue;
      const before = await Product.findById(item.productId).session(session || null).lean();
      const wasOut = before && before.stock === 0;
      const updated = await Product.findByIdAndUpdate(
        item.productId,
        { $inc: { stock: item.quantity } },
        { new: true, session }
      );
      if (updated) {
        await recordStockMovement({
          businessId: rejected.businessId,
          productId: updated._id,
          productName: updated.name,
          quantity: item.quantity,
          balanceAfter: updated.stock,
          reason: 'order_rejected',
          refType: 'order',
          refId: String(rejected._id),
          dedupeKey: `order:${rejected._id}:${updated._id}:order_rejected`,
          session,
        });
        if (wasOut && updated.stock > 0) {
          postCommit.push(() =>
            createNotification({ businessId: rejected.businessId, type: 'back_in_stock', title: 'Back in Stock', message: `${updated.name} is back in stock (${updated.stock} available)`, data: { productId: updated._id.toString() } })
          );
        }
      }
    }
    return rejected;
  });

  postCommit.forEach((fn) => { try { fn(); } catch (_) {} });
  return order;
};

const requestPayment = async (orderId) => {
  return Order.findByIdAndUpdate(
    orderId,
    { status: ORDER_STATUS.PENDING_PAYMENT },
    { new: true }
  );
};

const confirmPayment = async (orderId, { method, reference }) => {
  return Order.findByIdAndUpdate(
    orderId,
    {
      status: ORDER_STATUS.PAID,
      paymentMethod: method,
      paymentReference: reference,
      paymentConfirmedAt: new Date(),
    },
    { new: true }
  );
};

const markDelivered = async (orderId, note = '') => {
  return Order.findByIdAndUpdate(
    orderId,
    { status: ORDER_STATUS.DELIVERED, deliveryNote: note, deliveredAt: new Date() },
    { new: true }
  );
};

const { t } = require('../lang');

const formatOrderSummary = (order, lang = 'en') => {
  const items = order.items
    .map((i) => `  • ${i.productName} x${i.quantity} = ${i.currency} ${i.subtotal.toLocaleString()}`)
    .join('\n');
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const receiptUrl = order.status === 'PAID' || order.status === 'DELIVERED'
    ? `\n🧾 *${t('order.receipt_download', lang)}*: ${baseUrl}/api/orders/${order._id}/receipt`
    : '';
  const negotiatedLine = order.offeredTotal
    ? `\n🤝 ${t('order.negotiated_label', lang)}: ${order.currency} ${order.offeredTotal.toLocaleString()} (was ${order.currency} ${order.originalTotal.toLocaleString()})`
    : '';
  return (
    `📦 *Order ${order.orderNumber}*\n` +
    `${t('order.label_status', lang)}: ${order.status}\n` +
    `${t('order.label_customer', lang)}: ${order.customerName}\n` +
    `${t('order.label_whatsapp', lang)}: ${order.customerPhone.replace('@s.whatsapp.net', '')}\n` +
    (order.deliveryLocation ? `📍 ${t('order.label_delivery', lang)}: ${order.deliveryLocation}\n` : '') +
    (order.deliveryPhone ? `📞 ${t('order.label_contact', lang)}: ${order.deliveryPhone}\n` : '') +
    `${t('order.label_items', lang)}:\n${items}\n` +
    `*${t('order.label_total', lang)}: ${order.currency} ${order.total.toLocaleString()}*\n` +
    `${t('order.label_date', lang)}: ${order.createdAt.toLocaleString()}` +
    negotiatedLine +
    receiptUrl
  );
};

/**
 * Get orders filtered by time period.
 * @param {string} businessId
 * @param {'daily'|'weekly'|'monthly'|'yearly'|'all'} period
 * @param {string|null} status
 */
const getOrdersByPeriod = async (businessId = 'default', period = 'all', status = null) => {
  const query = { businessId, deletedAt: null };
  
  if (period && period !== 'all') {
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
        startDate = new Date(now.setDate(diff));
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'yearly':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = null;
    }
    
    if (startDate) {
      query.createdAt = { $gte: startDate };
    }
  }
  
  if (status) query.status = status;
  return Order.find(query).sort({ createdAt: -1 });
};

module.exports = {
  createOrder,
  createManualOrder,
  getOrdersByBusiness,
  getOrdersByCustomer,
  getOrderById,
  getOrderByNumber,
  getOrdersByPeriod,
  approveOrder,
  rejectOrder,
  requestPayment,
  confirmPayment,
  markDelivered,
  formatOrderSummary,
};
