const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Order = require('../models/Order');
const ChatContact = require('../models/ChatContact');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('recycleBin'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/recycle-bin — fetch all deleted items grouped by entity
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const isSuperAdmin = req.user.role === 'super_admin';

    const baseQuery = isSuperAdmin && !req.query.businessId
      ? {} // super admin see all
      : { businessId };
    const deletedQuery = { ...baseQuery, deletedAt: { $ne: null } };

    const [products, orders, contacts, notifications] = await Promise.all([
      Product.find(deletedQuery).sort({ deletedAt: -1 }).lean(),
      Order.find(deletedQuery).sort({ deletedAt: -1 }).lean(),
      ChatContact.find(deletedQuery).sort({ deletedAt: -1 }).lean(),
      Notification.find(deletedQuery).sort({ deletedAt: -1 }).lean(),
    ]);

    let users = [];
    if (isSuperAdmin) {
      users = await User.find({ deletedAt: { $ne: null } })
        .sort({ deletedAt: -1 })
        .select('-password')
        .lean();
    }

    res.json({
      success: true,
      data: { products, orders, contacts, notifications, users },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/recycle-bin/bulk-restore — restore all deleted items
router.post('/bulk-restore', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const isSuperAdmin = req.user.role === 'super_admin';
    const baseQuery = isSuperAdmin && !req.query.businessId ? {} : { businessId };
    const deletedQuery = { ...baseQuery, deletedAt: { $ne: null } };

    let restored = 0;

    const products = await Product.find(deletedQuery);
    for (const p of products) {
      p.deletedAt = undefined; p.deletedBy = undefined; p.active = true;
      await p.save(); restored++;
    }

    const orders = await Order.find(deletedQuery);
    for (const o of orders) {
      o.deletedAt = undefined; o.deletedBy = undefined;
      await o.save(); restored++;
    }

    const contacts = await ChatContact.find(deletedQuery);
    for (const c of contacts) {
      c.deletedAt = undefined; c.deletedBy = undefined;
      await c.save(); restored++;
    }

    const notifications = await Notification.find(deletedQuery);
    for (const n of notifications) {
      n.deletedAt = undefined; n.deletedBy = undefined;
      await n.save(); restored++;
    }

    if (isSuperAdmin) {
      const users = await User.find({ deletedAt: { $ne: null } });
      for (const u of users) {
        u.deletedAt = undefined; u.deletedBy = undefined; u.status = 'pending';
        await u.save(); restored++;
      }
    }

    res.json({ success: true, message: `${restored} items restored`, restored });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/recycle-bin/bulk-delete — permanently delete all items in recycle bin
router.post('/bulk-delete', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const isSuperAdmin = req.user.role === 'super_admin';
    const baseQuery = isSuperAdmin && !req.query.businessId ? {} : { businessId };
    const deletedQuery = { ...baseQuery, deletedAt: { $ne: null } };

    let deleted = 0;

    const prodRes = await Product.deleteMany(deletedQuery);
    deleted += prodRes.deletedCount;

    const orderRes = await Order.deleteMany(deletedQuery);
    deleted += orderRes.deletedCount;

    const contactRes = await ChatContact.deleteMany(deletedQuery);
    deleted += contactRes.deletedCount;

    const notifRes = await Notification.deleteMany(deletedQuery);
    deleted += notifRes.deletedCount;

    if (isSuperAdmin) {
      const userRes = await User.deleteMany({ deletedAt: { $ne: null } });
      deleted += userRes.deletedCount;
    }

    res.json({ success: true, message: `${deleted} items permanently deleted`, deleted });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/recycle-bin/restore/:type/:id — restore a single item
router.post('/restore/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const businessId = getBusinessId(req);
    const models = { products: Product, orders: Order, contacts: ChatContact, notifications: Notification };
    const Model = models[type];
    if (!Model) return res.status(400).json({ success: false, error: 'Invalid type' });

    const query = { _id: id, deletedAt: { $ne: null } };
    if (type !== 'users') query.businessId = businessId;
    const item = await Model.findOne(query);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    item.deletedAt = undefined;
    item.deletedBy = undefined;
    if (item.active !== undefined) item.active = true;
    if (item.status !== undefined && type === 'orders') item.status = item.status; // keep status
    await item.save();
    res.json({ success: true, message: 'Item restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/recycle-bin/:type/:id — permanently delete a single item
router.delete('/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const businessId = getBusinessId(req);
    const models = { products: Product, orders: Order, contacts: ChatContact, notifications: Notification };
    const Model = models[type];
    if (!Model) return res.status(400).json({ success: false, error: 'Invalid type' });

    const query = { _id: id };
    if (type !== 'users') query.businessId = businessId;
    const item = await Model.findOneAndDelete(query);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, message: 'Item permanently deleted' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
