const express = require('express');
const router = express.Router();
const Purchase = require('../models/Purchase');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { uploadMemory } = require('../middleware/upload');
const storage = require('../services/storageService');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('purchases'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/purchases — list purchases
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { period = 'all' } = req.query;
    const now = new Date();
    let startDate = null;
    switch (period) {
      case 'daily': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'weekly': { const d = now.getDay(); startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1)); break; }
      case 'monthly': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'annually': startDate = new Date(now.getFullYear(), 0, 1); break;
    }
    const filter = { businessId, deletedAt: null };
    if (startDate) filter.date = { $gte: startDate };
    const { limit, cursor, hasLimit } = parsePagination(req.query);
    const { items, nextCursor } = await paginate(Purchase, filter, { limit: limit || 100, cursor });
    // Resolve private-storage receipts to short-lived signed URLs.
    const withUrls = await Promise.all(
      items.map(async (p) => ({ ...p, receiptPath: await storage.resolveDisplayUrl(p.receiptPath) }))
    );
    const totalCost = withUrls.reduce((s, p) => s + (p.totalCost || 0), 0);
    res.json({ success: true, purchases: withUrls, totalCost, count: withUrls.length, nextCursor });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/purchases — create purchase and update stock
// Accepts either JSON (incl. offline-synced records) or multipart/form-data
// with an optional 'receipt' image file.
router.post('/', uploadMemory.single('receipt'), validate(schemas.purchaseCreateSchema), async (req, res) => {
  try {
    const body = req.body || {};
    const businessId = getBusinessId(req);
    const { productName, quantity, costPerUnit, supplier, date, notes, expiryDate, clientRef, productId } = body;
    if (!productName || !quantity || !costPerUnit) return res.status(400).json({ success: false, error: 'Product name, quantity, and cost are required' });

    let receiptPath = body.receiptPath || '';
    if (req.file) {
      try {
        const key = storage.newKey(`private/${businessId}/receipts`);
        await storage.putObject(key, req.file.buffer, req.file.mimetype || 'image/jpeg', {
          businessId,
          purpose: 'purchase_receipt',
          createdBy: req.user.email || '',
        });
        receiptPath = `store:${key}`;
      } catch (e) {
        return res.status(500).json({ success: false, error: 'Storage failed: ' + e.message });
      }
    }

    const qty = Number(quantity);
    const cost = Number(costPerUnit);
    const totalCost = qty * cost;
    const recordedBy = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const expiry = expiryDate ? new Date(expiryDate) : null;

    let doc;
    let wasCreated = true;

    if (clientRef) {
      // Upsert on (businessId, clientRef) so a re-sent create (e.g. offline sync
      // retry or double-submit) does not produce a duplicate purchase.
      const result = await Purchase.findOneAndUpdate(
        { businessId, clientRef },
        {
          $setOnInsert: {
            businessId,
            productName: productName.trim(),
            productId: productId || null,
            quantity: qty,
            costPerUnit: cost,
            totalCost,
            supplier: supplier || '',
            recordedBy,
            expiryDate: expiry,
            date: date || new Date(),
            notes: notes || '',
            receiptPath,
            clientRef,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true }
      );
      doc = result.value;
      wasCreated = !!(result.lastErrorObject && result.lastErrorObject.upserted);
    } else {
        doc = await Purchase.create({
        businessId,
        productName: productName.trim(),
        quantity: qty,
        costPerUnit: cost,
        totalCost,
        supplier: supplier || '',
        recordedBy,
        expiryDate: expiry,
        date: date || new Date(),
        notes: notes || '',
        receiptPath,
      });
    }

    // Purchases are no longer linked to products, so no stock adjustment here.

    const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    res.status(wasCreated ? 201 : 200).json({
      success: true,
      purchase: { ...plain, receiptPath: await storage.resolveDisplayUrl(plain.receiptPath) },
    });

    // Fire-and-forget expiry check (e.g. if this batch is already expired/near)
    const { checkExpiries } = require('../services/expiryService');
    checkExpiries().catch(() => {});
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PATCH /api/purchases/:id — update a purchase (e.g. attach a receipt image)
router.patch('/:id', uploadMemory.single('receipt'), validate(schemas.purchaseUpdateSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const purchase = await Purchase.findOne({ _id: req.params.id, businessId, deletedAt: null });
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found' });

    const update = {};
    const body = req.body || {};
    ['productName', 'quantity', 'costPerUnit', 'supplier', 'notes', 'expiryDate', 'date'].forEach((f) => {
      if (body[f] !== undefined) update[f] = body[f];
    });
    if (typeof update.quantity === 'string') update.quantity = Number(update.quantity);
    if (typeof update.costPerUnit === 'string') update.costPerUnit = Number(update.costPerUnit);
    if (update.quantity != null && update.costPerUnit != null) update.totalCost = update.quantity * update.costPerUnit;

    if (req.file) {
      try {
        const key = storage.newKey(`private/${businessId}/receipts`);
        await storage.putObject(key, req.file.buffer, req.file.mimetype || 'image/jpeg', {
          businessId,
          purpose: 'purchase_receipt',
          createdBy: req.user.email || '',
        });
        update.receiptPath = `store:${key}`;
      } catch (e) {
        return res.status(500).json({ success: false, error: 'Storage failed: ' + e.message });
      }
    } else if (body.receiptPath === '') {
      // Explicit clear only; ignore echoed signed URLs.
      update.receiptPath = '';
    }

    const updated = await Purchase.findOneAndUpdate(
      { _id: req.params.id, businessId },
      update,
      { new: true }
    );
    const plain = updated ? updated.toObject() : updated;
    res.json({
      success: true,
      purchase: plain ? { ...plain, receiptPath: await storage.resolveDisplayUrl(plain.receiptPath) } : plain,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/purchases/:id
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const purchase = await Purchase.findOneAndUpdate(
      { _id: req.params.id, businessId },
      { deletedAt: new Date(), deletedBy: req.user.email || 'admin' },
      { new: true }
    );
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found' });
    res.json({ success: true, message: 'Purchase deleted' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
