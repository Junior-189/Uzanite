const express = require('express');
const router = express.Router();
const Business = require('../models/Business');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { sendServerError } = require('../utils/safeError');

// AUDIT FIX (V1): this router was completely unauthenticated, allowing anyone
// to overwrite a tenant's M-Pesa/Tigo/Airtel payment numbers (payment
// redirection fraud). All routes now require auth + tenant approval.
router.use(protect, tenantApproved, requireFeature('business'));

function isPlatformAdmin(user) {
  return user && (user.role === 'super_admin' || user.role === 'sub_admin');
}

// A tenant may only ever touch their own business record. Platform admins may
// target a business explicitly (query/param) for support.
function resolveBusinessId(req) {
  if (isPlatformAdmin(req.user)) {
    return req.params.businessId || req.query.businessId || req.user.businessId;
  }
  return req.user.businessId;
}

// Only these fields may ever be written from the client (mass-assignment guard).
function buildUpdate(body) {
  const update = {};
  if (body.name !== undefined) update.name = String(body.name).trim();
  if (body.phone !== undefined) update.phone = String(body.phone).trim();
  if (body.description !== undefined) update.description = String(body.description);
  if (body.currency !== undefined) update.currency = String(body.currency).trim();
  if (body.active !== undefined && typeof body.active === 'boolean') update.active = body.active;

  // Map flat client form fields into the nested payment structure.
  const payment = {};
  if (body.mpesaNumber !== undefined || body.mpesaName !== undefined) {
    payment.mpesa = { number: body.mpesaNumber || '', name: body.mpesaName || '' };
  }
  if (body.tigoNumber !== undefined) payment.tigo = { number: body.tigoNumber || '' };
  if (body.airtelNumber !== undefined) payment.airtel = { number: body.airtelNumber || '' };
  if (Object.keys(payment).length > 0) update.payment = payment;

  return update;
}

// GET /api/businesses — returns only the logged-in tenant's own business
router.get('/', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(404).json({ success: false, error: 'No business linked to this account' });
    }
    const business = await Business.findOne({ businessId, active: true });
    res.json({ success: true, businesses: business ? [business] : [] });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/businesses — create the caller's business record.
// Tenants can only create their own; only super_admin may specify an arbitrary id.
router.post('/', async (req, res) => {
  try {
    const isSuper = req.user.role === 'super_admin';
    const businessId = isSuper ? (req.body.businessId || req.user.businessId) : req.user.businessId;
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'No business linked to this account' });
    }
    const { name, phone, description } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'name and phone are required' });
    }
    const exists = await Business.findOne({ businessId });
    if (exists) return res.status(409).json({ success: false, error: 'Business ID already exists' });

    const business = await Business.create({
      businessId,
      name: String(name).trim(),
      phone: String(phone).trim(),
      description: description ? String(description) : '',
      currency: req.body.currency ? String(req.body.currency).trim() : 'TZS',
      payment: buildUpdate(req.body).payment || {},
    });
    res.status(201).json({ success: true, business });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/businesses/:businessId
router.put('/:businessId', async (req, res) => {
  try {
    const targetId = resolveBusinessId(req);
    // Tenants cannot edit another tenant's business.
    if (!isPlatformAdmin(req.user) && req.params.businessId !== req.user.businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const update = buildUpdate(req.body || {});
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const business = await Business.findOneAndUpdate(
      { businessId: targetId },
      update,
      { new: true, runValidators: true }
    );
    if (!business) return res.status(404).json({ success: false, error: 'Business not found' });
    res.json({ success: true, business });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
