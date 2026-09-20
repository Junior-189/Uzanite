const Payment = require('../models/Payment');
const Order = require('../models/Order');
const { ORDER_STATUS } = require('../models/Order');
const { getProvider } = require('../payments');
const { recordLedger } = require('./ledgerService');
const storage = require('./storageService');
const { withTransaction } = require('../db/transaction');
const { createNotification } = require('./notificationStore');
const logger = require('../config/logger');
const metrics = require('../lib/metrics');

function mapStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['success', 'succeeded', 'completed', 'paid', 'settled'].includes(s)) return 'succeeded';
  if (['failed', 'error', 'declined', 'rejected'].includes(s)) return 'failed';
  if (['cancelled', 'canceled'].includes(s)) return 'cancelled';
  if (['processing', 'in_progress'].includes(s)) return 'processing';
  return 'pending';
}

// Initiate a payment (STK push via provider, or manual instructions).
async function initiate({ businessId, orderId, phone, method, providerName, initiatedBy = '' }) {
  const order = await Order.findOne({ _id: orderId, businessId });
  if (!order) throw new Error('Order not found');
  if (order.status === ORDER_STATUS.PAID || order.status === ORDER_STATUS.DELIVERED) {
    throw new Error('Order is already paid');
  }

  const provider = getProvider(providerName);
  if (!provider) throw new Error(`Unknown payment provider: ${providerName}`);

  const idempotencyKey = `order:${orderId}:${provider.name}`;
  let payment = await Payment.findOne({ businessId, idempotencyKey });
  if (payment && ['pending', 'processing', 'succeeded'].includes(payment.status)) return payment;

  if (!payment) {
    payment = await Payment.create({
      businessId,
      orderId: order._id,
      provider: provider.name,
      method: method || 'manual',
      amount: order.total,
      currency: order.currency,
      phone: phone || order.customerPhone,
      status: 'initiated',
      idempotencyKey,
      initiatedBy,
    });
  }

  if (!provider.enabled()) {
    payment.status = 'pending';
    await payment.save();
    return payment;
  }

  try {
    const result = await provider.initiate({
      businessId,
      order,
      phone: phone || order.customerPhone,
      amount: order.total,
      currency: order.currency,
      method,
      reference: payment._id.toString(),
    });
    payment.providerRef = result.providerRef || payment.providerRef;
    payment.status = mapStatus(result.status || 'pending');
    payment.raw = result.raw || {};
    await payment.save();
    return payment;
  } catch (err) {
    payment.status = 'failed';
    payment.failureReason = err.message;
    await payment.save().catch(() => {});
    throw err;
  }
}

// Manual confirmation (with optional proof image) — always available.
async function confirmManual({ businessId, orderId, method, reference, proofBuffer, proofContentType, recordedBy = '' }) {
  const order = await Order.findOne({ _id: orderId, businessId });
  if (!order) throw new Error('Order not found');

  // Idempotent: if already paid, return the existing succeeded payment.
  if (order.status === ORDER_STATUS.PAID || order.status === ORDER_STATUS.DELIVERED) {
    const existing = await Payment.findOne({ businessId, orderId: order._id, status: 'succeeded' }).sort({ createdAt: -1 });
    if (existing) return existing;
  }

  let proofPath = null;
  if (proofBuffer) {
    const key = storage.newKey(`private/${businessId}/proofs`);
    await storage.putObject(key, proofBuffer, proofContentType || 'image/jpeg', {
      businessId,
      purpose: 'payment_proof',
      createdBy: recordedBy,
    });
    proofPath = `store:${key}`;
  }

  const payment = await withTransaction(async (session) => {
    const [created] = await Payment.create(
      [
        {
          businessId,
          orderId: order._id,
          provider: 'manual',
          method: method || 'manual',
          providerRef: reference || `manual-${order._id}-${Date.now()}`,
          amount: order.total,
          currency: order.currency,
          phone: order.customerPhone,
          status: 'succeeded',
          proofPath,
          confirmedAt: new Date(),
          initiatedBy: recordedBy,
        },
      ],
      { session }
    );

    await Order.findOneAndUpdate(
      { _id: order._id, businessId },
      {
        status: ORDER_STATUS.PAID,
        paymentMethod: method || 'manual',
        paymentReference: reference || 'N/A',
        paymentProofPath: proofPath || order.paymentProofPath || null,
        paymentConfirmedAt: new Date(),
      },
      { session }
    );

    await recordLedger({
      businessId,
      type: 'payment_in',
      direction: 'credit',
      amount: order.total,
      currency: order.currency,
      refType: 'payment',
      refId: created._id.toString(),
      description: `Manual payment confirmation (${method || 'manual'})`,
      meta: { reference, orderId: String(order._id) },
      recordedBy,
      session,
    });

    return created;
  });

  createNotification({
    businessId,
    type: 'payment_confirmed',
    title: 'Payment Confirmed',
    message: `Manual payment confirmed for order ${order.orderNumber}`,
    data: { orderId: String(order._id), paymentId: String(payment._id) },
    priority: 'high',
  });

  metrics.inc('uzanite_payments_succeeded_total', { provider: 'manual' });
  return payment;
}

// Apply an asynchronous provider result (webhook). Idempotent.
async function applyResult({ providerName, providerRef, status, amount, currency, raw, failureReason }) {
  if (!providerRef) return { matched: false };
  const payment = await Payment.findOne({ providerRef });
  if (!payment) {
    logger.warn({ providerRef, providerName }, 'Payment webhook for unknown providerRef');
    return { matched: false };
  }
  if (payment.status === 'succeeded') return { matched: true, payment, duplicate: true };

  const mapped = mapStatus(status);

  const updated = await withTransaction(async (session) => {
    payment.status = mapped;
    if (mapped === 'succeeded') payment.confirmedAt = new Date();
    if (mapped === 'failed') payment.failureReason = failureReason || 'Payment failed';
    payment.raw = raw || payment.raw;
    await payment.save({ session });

    if (mapped === 'succeeded' && payment.orderId) {
      await Order.findOneAndUpdate(
        { _id: payment.orderId, businessId: payment.businessId },
        {
          status: ORDER_STATUS.PAID,
          paymentMethod: payment.method,
          paymentReference: providerRef,
          paymentConfirmedAt: new Date(),
        },
        { session }
      );
      await recordLedger({
        businessId: payment.businessId,
        type: 'payment_in',
        direction: 'credit',
        amount: payment.amount,
        currency: payment.currency,
        refType: 'payment',
        refId: payment._id.toString(),
        description: `Payment via ${providerName}`,
        meta: { providerRef, provider: providerName, orderId: String(payment.orderId) },
        session,
      });
    }
    return payment;
  });

  if (mapped === 'succeeded') {
    createNotification({
      businessId: payment.businessId,
      type: 'payment_confirmed',
      title: 'Payment Confirmed',
      message: `Payment of ${payment.currency} ${payment.amount.toLocaleString()} confirmed via ${providerName}`,
      data: { orderId: String(payment.orderId), paymentId: String(payment._id) },
      priority: 'high',
    });
    metrics.inc('uzanite_payments_succeeded_total', { provider: providerName });
  }

  return { matched: true, payment: updated };
}

async function listForOrder(businessId, orderId) {
  return Payment.find({ businessId, orderId }).sort({ createdAt: -1 }).lean();
}

module.exports = { initiate, confirmManual, applyResult, listForOrder, mapStatus };
