const Order = require('../models/Order');
const {
  sendReceiptImageToCustomer,
  sendReceiptToCustomer,
} = require('../services/receiptService');

// Receipt generation + delivery runs in the background (image by default).
async function sendReceiptJob({ businessId, orderId, mode = 'image' }) {
  const order = await Order.findOne({ _id: orderId, businessId });
  if (!order) throw new Error(`Order ${orderId} not found for receipt`);
  if (mode === 'document') return sendReceiptToCustomer(null, order, businessId);
  return sendReceiptImageToCustomer(null, order, businessId);
}

module.exports = { receipts: { send: sendReceiptJob } };
