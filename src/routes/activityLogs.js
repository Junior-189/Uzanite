const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const LoginAttempt = require('../models/LoginAttempt');
const { protect, adminOnly } = require('../middleware/auth');
const { sendServerError } = require('../utils/safeError');
const { escapeRegex } = require('../utils/escapeRegex');

router.use(protect);
router.use(adminOnly);

// GET /api/admin/activity-logs — list activity logs
router.get('/activity-logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, userId, search, startDate, endDate } = req.query;
    const filter = {};

    if (userId) filter.userId = userId;
    if (search) {
      const rx = escapeRegex(search);
      filter.$or = [
        { page: { $regex: rx, $options: 'i' } },
        { userName: { $regex: rx, $options: 'i' } },
        { userEmail: { $regex: rx, $options: 'i' } },
        { device: { $regex: rx, $options: 'i' } },
        { browser: { $regex: rx, $options: 'i' } },
      ];
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const logs = await ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await ActivityLog.countDocuments(filter);

    res.json({ success: true, logs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/admin/activity-logs/summary — dashboard stats
router.get('/activity-logs/summary', async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today - 30 * 24 * 60 * 60 * 1000);

    const [totalVisits, todayVisits, uniqueVisitors, topPages, deviceBreakdown, browserBreakdown, recentActivity] = await Promise.all([
      ActivityLog.countDocuments(),
      ActivityLog.countDocuments({ createdAt: { $gte: today } }),
      ActivityLog.distinct('sessionId').then((s) => s.length),
      ActivityLog.aggregate([
        { $group: { _id: '$page', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      ActivityLog.aggregate([
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityLog.aggregate([
        { $group: { _id: '$browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityLog.find().sort({ createdAt: -1 }).limit(20).select('userName page action device browser os createdAt'),
    ]);

    res.json({
      success: true,
      totalVisits,
      todayVisits,
      uniqueVisitors,
      topPages,
      deviceBreakdown,
      browserBreakdown,
      recentActivity,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/admin/login-attempts — list login attempts
router.get('/login-attempts', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, email, startDate, endDate } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (email) filter.email = { $regex: escapeRegex(email), $options: 'i' };
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const attempts = await LoginAttempt.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await LoginAttempt.countDocuments(filter);

    res.json({ success: true, attempts, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/admin/login-attempts/summary — login stats
router.get('/login-attempts/summary', async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalAttempts, todayAttempts, statusBreakdown, recentAttempts, failedEmails] = await Promise.all([
      LoginAttempt.countDocuments(),
      LoginAttempt.countDocuments({ createdAt: { $gte: today } }),
      LoginAttempt.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      LoginAttempt.find().sort({ createdAt: -1 }).limit(20).select('email userName role status reason ip device browser os createdAt'),
      LoginAttempt.aggregate([
        { $match: { status: 'failed' } },
        { $group: { _id: '$email', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.json({
      success: true,
      totalAttempts,
      todayAttempts,
      statusBreakdown,
      recentAttempts,
      failedEmails,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/admin/activity-logs — clear old logs
router.delete('/activity-logs', async (req, res) => {
  try {
    const { days = 90 } = req.query;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await ActivityLog.deleteMany({ createdAt: { $lt: cutoff } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/admin/login-attempts — clear old attempts
router.delete('/login-attempts', async (req, res) => {
  try {
    const { days = 90 } = req.query;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await LoginAttempt.deleteMany({ createdAt: { $lt: cutoff } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
