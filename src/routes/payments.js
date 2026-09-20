const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { uploadMemory } = require('../middleware/upload');
const paymentService = require('../services/paymentService');
const { listProviders } = require('../payments');
const Payment = require('../models/Payment');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved);

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/payments/providers — available providers + enabled state.
router.get('/providers', (req, res) => {
  res.json({ success: true, providers: listProviders() });
});

// GET /api/payments — recent payments for the tenant.
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { limit, cursor, hasLimit } = parsePagination(req.query);
    const { items, nextCursor } = await paginate(Payment, { businessId }, { limit: limit || 100, cursor });
    res.json({ success: true, payments: items, nextCursor });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/payments/orders/:id — payments for a specific order.
router.get('/orders/:id', async (req, res) => {
  try {
    const payments = await paymentService.listForOrder(getBusinessId(req), req.params.id);
    res.json({ success: true, payments });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/payments/orders/:id/initiate — start an STK push (or manual instructions).
router.post('/orders/:id/initiate', validate(schemas.paymentInitiateSchema), async (req, res) => {
  try {
    const payment = await paymentService.initiate({
      businessId: getBusinessId(req),
      orderId: req.params.id,
      phone: req.body.phone,
      method: req.body.method,
      providerName: req.body.provider,
      initiatedBy: req.user.email || String(req.user._id),
    });
    res.json({
      success: true,
      payment: {
        id: payment._id,
        status: payment.status,
        provider: payment.provider,
        providerRef: payment.providerRef,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/payments/orders/:id/manual — confirm a manual payment (optional proof image).
router.post('/orders/:id/manual', uploadMemory.single('proof'), validate(schemas.paymentManualSchema), async (req, res) => {
  try {
    const payment = await paymentService.confirmManual({
      businessId: getBusinessId(req),
      orderId: req.params.id,
      method: req.body.method,
      reference: req.body.reference,
      proofBuffer: req.file ? req.file.buffer : null,
      proofContentType: req.file ? req.file.mimetype : null,
      recordedBy: req.user.email || String(req.user._id),
    });
    res.json({ success: true, payment });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
