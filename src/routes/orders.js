const express = require('express');
const router = express.Router();
const {
  getOrdersByBusiness,
  getOrdersByCustomer,
  getOrdersByPeriod,
  getOrderById,
  getOrderByNumber,
  approveOrder,
  rejectOrder,
  requestPayment,
  markDelivered,
  formatOrderSummary,
  createManualOrder,
} = require('../services/orderService');
const {
  notifyCustomerOrderApproved,
  notifyCustomerOrderRejected,
  notifyCustomerPaymentConfirmed,
  notifyCustomerDelivered,
} = require('../services/notificationService');
const { getSock } = require('../whatsapp/transport');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { withTransaction } = require('../db/transaction');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Staff = require('../models/Staff');
const { createNotification } = require('../services/notificationStore');
const { generateReceiptPDF } = require('../services/receiptService');
const { recordStockMovement } = require('../services/ledgerService');
const paymentService = require('../services/paymentService');
const { parsePagination, paginate } = require('../utils/pagination');
const path = require('path');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "orders" feature flag.
router.use(protect, tenantApproved, requireFeature('orders'));

// Queue a receipt for background generation + delivery.
async function enqueueReceipt(businessId, orderId, mode = 'image') {
  const { enqueue } = require('../queue/queues');
  return enqueue('receipts', 'send', { businessId, orderId, mode });
}

// Helper to get businessId from authenticated user
function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// Normalize the "recorded by" label for the response: any cash order that was
// not recorded by a known staff member is shown as "Owner" (so legacy orders
// stored under the business/owner name display consistently).
async function normalizeRecordedBy(businessId, orders) {
  const staffDocs = await Staff.find({ businessId }).select('name').lean();
  const staffNames = new Set(staffDocs.map((s) => (s.name || '').trim()).filter(Boolean));
  const mapOne = (o) => {
    const obj = o && typeof o.toObject === 'function' ? o.toObject() : o;
    if (obj && obj.source === 'cash') {
      const rb = (obj.recordedBy || '').trim();
      if (!rb || !staffNames.has(rb)) obj.recordedBy = 'Owner';
    }
    return obj;
  };
  return Array.isArray(orders) ? orders.map(mapOne) : mapOne(orders);
}

// GET /api/orders — list orders (filter by period, status, customerPhone)
router.get('/', async (req, res) => {
  try {
    const { status, customerPhone, period } = req.query;
    const businessId = getBusinessId(req);
    const { limit, cursor, hasLimit } = parsePagination(req.query);

    // Cursor pagination for the common list view.
    if ((hasLimit || cursor) && !customerPhone && (!period || period === 'all')) {
      const filter = { businessId, deletedAt: null };
      if (status) filter.status = status;
      const { items, nextCursor } = await paginate(Order, filter, { limit: limit || 100, cursor });
      const normalized = await normalizeRecordedBy(businessId, items);
      return res.json({ success: true, count: normalized.length, orders: normalized, nextCursor });
    }

    let orders;
    if (customerPhone) {
      orders = await getOrdersByCustomer(customerPhone, businessId);
    } else if (period && period !== 'all') {
      orders = await getOrdersByPeriod(businessId, period, status || null);
    } else {
      orders = await getOrdersByBusiness(businessId, status || null);
    }
    const normalized = await normalizeRecordedBy(businessId, orders);
    res.json({ success: true, count: normalized.length, orders: normalized, nextCursor: null });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/manual — create a manual cash order (walk-in customer)
router.post('/manual', validate(schemas.manualOrderSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { customerName, customerPhone, customerEmail, items } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, error: 'Items are required' });
    }
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity < 1) {
        return res.status(400).json({ success: false, error: 'Each item needs a productId and quantity >= 1' });
      }
    }
    const staffName = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const order = await createManualOrder({ businessId, customerName: customerName?.trim() || 'Walk-in Customer', customerPhone, customerEmail, items, recordedBy: staffName, clientRef: req.body.clientRef });
    createNotification({ businessId, type: 'order_created', title: 'Manual Order', message: `Walk-in order ${order.orderNumber} for ${customerName} — Cash`, data: { orderId: order._id.toString() } });
    createNotification({ businessId, type: 'order_paid', title: 'Order Paid', message: `Walk-in order ${order.orderNumber} paid via Cash`, data: { orderId: order._id.toString() } });
    // Queue receipt delivery (background, with retries) if a phone was provided.
    if (customerPhone) {
      enqueueReceipt(businessId, order._id, 'image').catch((err) =>
        console.error('Failed to enqueue receipt:', err.message)
      );
    }
    res.json({ success: true, order, message: 'Manual order created and marked as paid' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders — create a manual cash order (client posts here from createOffline)
router.post('/', validate(schemas.manualOrderSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { customerName, customerPhone, customerEmail, items } = req.body;
    if (!items || !items.length) {
      return res.status(400).json({ success: false, error: 'Items are required' });
    }
    const normalizedItems = items.map((item) => ({
      productId: item.productId,
      productName: item.productName || '',
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 1),
      subtotal: Number(item.subtotal || (Number(item.price || 0) * Number(item.quantity || 1))),
      currency: item.currency || 'TZS',
    }));
    const staffName = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const order = await createManualOrder({ businessId, customerName: customerName?.trim() || 'Walk-in Customer', customerPhone, customerEmail, items: normalizedItems, recordedBy: staffName, clientRef: req.body.clientRef });
    createNotification({ businessId, type: 'order_created', title: 'Cash Order', message: `Order ${order.orderNumber} for ${customerName} — Cash`, data: { orderId: order._id.toString() } });
    createNotification({ businessId, type: 'order_paid', title: 'Order Paid', message: `Order ${order.orderNumber} paid via Cash`, data: { orderId: order._id.toString() } });
    if (customerPhone) {
      enqueueReceipt(businessId, order._id, 'image').catch((err) =>
        console.error('Failed to enqueue receipt:', err.message)
      );
    }
    res.json({ success: true, order, message: 'Order created and marked as paid' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/orders/:id — get one order by MongoDB ID
router.get('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    res.json({ success: true, order: await normalizeRecordedBy(businessId, order) });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/send-receipt — manually send receipt to customer
router.post('/:id/send-receipt', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (!order.customerPhone) {
      return res.status(400).json({ success: false, error: 'Order has no customer phone number' });
    }

    await enqueueReceipt(businessId, order._id, 'image');
    res.json({
      success: true,
      message: 'Receipt queued for delivery',
      order,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/approve
router.post('/:id/approve', validate(schemas.orderNoteSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    const approved = await approveOrder(order._id, req.body.note || '');
    // Automatically request payment right after approval
    const updated = await requestPayment(approved._id);
    const sock = getSock(businessId);
    if (sock) await notifyCustomerOrderApproved(sock, updated, null, businessId);
    createNotification({ businessId, type: 'order_approved', title: 'Order Approved', message: `Order ${updated.orderNumber} approved for ${updated.customerName}`, data: { orderId: updated._id.toString() } });
    createNotification({ businessId, type: 'payment_received', title: 'Payment Requested', message: `Payment requested for order ${updated.orderNumber}`, data: { orderId: updated._id.toString() } });
    res.json({ success: true, order: updated, message: 'Order approved, payment requested, and customer notified' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/reject
router.post('/:id/reject', validate(schemas.orderRejectSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    const updated = await rejectOrder(order._id, req.body.reason || '');
    const sock = getSock(businessId);
    if (sock) await notifyCustomerOrderRejected(sock, updated, null, businessId);
    createNotification({ businessId, type: 'order_rejected', title: 'Order Rejected', message: `Order ${updated.orderNumber} rejected. Reason: ${req.body.reason || 'N/A'}`, data: { orderId: updated._id.toString() }, priority: 'high' });
    res.json({ success: true, order: updated, message: 'Order rejected and customer notified' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/request-payment
router.post('/:id/request-payment', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    const updated = await requestPayment(order._id);
    const sock = getSock(businessId);
    if (sock) await notifyCustomerOrderApproved(sock, updated, null, businessId);
    res.json({ success: true, order: updated });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/confirm-payment
router.post('/:id/confirm-payment', validate(schemas.confirmPaymentSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { method, reference } = req.body;
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    // Records an immutable Payment + ledger entry and marks the order PAID.
    const payment = await paymentService.confirmManual({
      businessId,
      orderId: order._id,
      method: method || 'manual',
      reference: reference || 'N/A',
      recordedBy: req.user.email || String(req.user._id),
    });
    const updated = await getOrderById(order._id);
    const sock = getSock(businessId);
    if (sock) {
      await notifyCustomerPaymentConfirmed(sock, updated, null, businessId);
    }
    res.json({ success: true, order: updated, payment, message: 'Payment confirmed, receipt queued, and customer notified' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/orders/:id/deliver
router.post('/:id/deliver', validate(schemas.orderNoteSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    const updated = await markDelivered(order._id, req.body.note || '');
    const sock = getSock(businessId);
    if (sock) await notifyCustomerDelivered(sock, updated, null, businessId);
    createNotification({ businessId, type: 'order_delivered', title: 'Order Delivered', message: `Order ${updated.orderNumber} marked as delivered for ${updated.customerName}`, data: { orderId: updated._id.toString() } });
    res.json({ success: true, order: updated, message: 'Delivery confirmed and customer notified' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/orders/:id — soft delete order
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    if (req.query.permanent === 'true') {
      await withTransaction(async (session) => {
        for (const item of order.items) {
          if (item.productId) {
            const updated = await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity } }, { new: true, session });
            if (updated) {
              await recordStockMovement({
                businessId,
                productId: updated._id,
                productName: updated.name,
                quantity: item.quantity,
                balanceAfter: updated.stock,
                reason: 'order_deleted',
                refType: 'order',
                refId: String(order._id),
                dedupeKey: `order:${order._id}:${updated._id}:order_deleted`,
                session,
              });
            }
          }
        }
        await Order.findByIdAndDelete(req.params.id, { session });
      });
      return res.json({ success: true, message: 'Order permanently deleted' });
    }
    // Soft delete — atomic guard ensures stock is reversed exactly once.
    await withTransaction(async (session) => {
      const locked = await Order.findOneAndUpdate(
        { _id: req.params.id, deletedAt: null },
        { deletedAt: new Date(), deletedBy: req.user._id },
        { new: true, session }
      );
      if (!locked) return; // already deleted by a concurrent request
      if (locked.status !== 'REJECTED') {
        for (const item of locked.items) {
          if (item.productId) {
            const updated = await Product.findByIdAndUpdate(item.productId, { $inc: { stock: item.quantity } }, { new: true, session });
            if (updated) {
              await recordStockMovement({
                businessId,
                productId: updated._id,
                productName: updated.name,
                quantity: item.quantity,
                balanceAfter: updated.stock,
                reason: 'order_deleted',
                refType: 'order',
                refId: String(locked._id),
                dedupeKey: `order:${locked._id}:${updated._id}:order_deleted`,
                session,
              });
            }
          }
        }
      }
    });
    res.json({ success: true, message: 'Order moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/orders/:id/restore — restore order from recycle bin
router.put('/:id/restore', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const restored = await withTransaction(async (session) => {
      const order = await Order.findOneAndUpdate(
        { _id: req.params.id, businessId, deletedAt: { $ne: null } },
        { $unset: { deletedAt: 1, deletedBy: 1 } },
        { new: true, session }
      );
      if (!order) return null;
      // Re-apply the stock impact that was reversed on delete (unless rejected).
      if (order.status !== 'REJECTED') {
        for (const item of order.items) {
          if (item.productId) {
            const updated = await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -item.quantity } }, { new: true, session });
            if (updated) {
              await recordStockMovement({
                businessId,
                productId: updated._id,
                productName: updated.name,
                quantity: -item.quantity,
                balanceAfter: updated.stock,
                reason: 'order_restored',
                refType: 'order',
                refId: String(order._id),
                dedupeKey: `order:${order._id}:${updated._id}:order_restored`,
                session,
              });
            }
          }
        }
      }
      return order;
    });
    if (!restored) return res.status(404).json({ success: false, error: 'Order not found in recycle bin' });
    res.json({ success: true, message: 'Order restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/orders/:id/receipt — download receipt PDF
router.get('/:id/receipt', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.businessId !== businessId) return res.status(403).json({ success: false, error: 'Access denied' });

    const { filePath: pdfPath } = await generateReceiptPDF(order);
    res.download(pdfPath, `receipt_${order.orderNumber || order._id}.pdf`);
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;