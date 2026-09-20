const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
} = require('../services/notificationStore');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('notifications'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/notifications — list notifications
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { limit, cursor, hasLimit } = parsePagination(req.query, { defaultLimit: 50 });
    const unreadCount = await getUnreadCount(businessId);

    if (hasLimit || cursor) {
      const filter = { businessId, deletedAt: null };
      if (req.query.unreadOnly === 'true') filter.read = false;
      const { items, nextCursor } = await paginate(Notification, filter, { limit: limit || 50, cursor });
      return res.json({ success: true, notifications: items, unreadCount, nextCursor });
    }

    const { limit: legacyLimit = 50, skip = 0, unreadOnly = false } = req.query;
    const notifications = await getNotifications(businessId, {
      limit: parseInt(legacyLimit),
      skip: parseInt(skip),
      unreadOnly: unreadOnly === 'true',
    });
    res.json({ success: true, notifications, unreadCount, nextCursor: null });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/notifications/unread-count — get unread count only
router.get('/unread-count', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const count = await getUnreadCount(businessId);
    res.json({ success: true, count });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/notifications/:id/read — mark as read
router.put('/:id/read', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const notif = await markAsRead(req.params.id, businessId);
    if (!notif) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.json({ success: true, notification: notif });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    await markAllAsRead(businessId);
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/notifications — soft delete all notifications (move to recycle bin)
router.delete('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    await deleteAllNotifications(businessId, req.user._id);
    res.json({ success: true, message: 'All notifications moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/notifications/:id — soft delete notification
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    if (req.query.permanent === 'true') {
      const notif = await Notification.findOneAndDelete({ _id: req.params.id, businessId });
      if (!notif) return res.status(404).json({ success: false, error: 'Notification not found' });
      return res.json({ success: true, message: 'Notification permanently deleted' });
    }
    const notif = await deleteNotification(req.params.id, businessId, req.user._id);
    if (!notif) return res.status(404).json({ success: false, error: 'Notification not found' });
    res.json({ success: true, message: 'Notification moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/notifications/:id/restore — restore notification from recycle bin
router.put('/:id/restore', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, businessId, deletedAt: { $ne: null } },
      { $unset: { deletedAt: 1, deletedBy: 1 } },
      { new: true }
    );
    if (!notif) return res.status(404).json({ success: false, error: 'Notification not found in recycle bin' });
    res.json({ success: true, message: 'Notification restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;