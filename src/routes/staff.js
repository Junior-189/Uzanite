const express = require('express');
const router = express.Router();
const Staff = require('../models/Staff');
const LoginAttempt = require('../models/LoginAttempt');
const { protect, tenantApproved, checkLoginLockout, recordFailedLogin, clearLoginAttempts } = require('../middleware/auth');
const { parseUserAgent } = require('../middleware/activity');
const { sendEmail } = require('../services/emailService');
const { escapeHtml } = require('../utils/escapeHtml');
const { signAccessToken, issueRefreshToken, revokeAllForUser } = require('../services/tokenService');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { requireFeature } = require('../middleware/featureGuard');
const { enforceLimit } = require('../middleware/planGuard');
const { sendServerError } = require('../utils/safeError');

function getBusinessId(req) {
  return req.user.businessId;
}

function humanDuration(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.ceil(ms / 3600000);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.ceil(ms / 86400000);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// ── Staff Login ──
router.post('/login', validate(schemas.loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUserAgent(userAgent);
    const loginInfo = { ip, userAgent, device, browser, os };

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    // Account lockout after repeated failed attempts (escalating)
    const lock = await checkLoginLockout(email);
    if (lock.locked) {
      const remaining = lock.lockedUntil - Date.now();
      return res.status(429).json({
        success: false,
        error: `Too many failed attempts. Please wait ${humanDuration(remaining)} before trying again.`,
        lockout: true,
        retryAfter: Math.ceil(remaining / 1000),
      });
    }

    const staff = await Staff.findOne({ email: email.toLowerCase() });
    if (!staff) {
      await LoginAttempt.create({ email, status: 'failed', reason: 'Staff not found', role: 'staff', ...loginInfo });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (staff.status !== 'active') {
      await LoginAttempt.create({ email, userId: staff._id, userName: staff.name, role: 'staff', status: 'inactive', reason: 'Staff account inactive', ...loginInfo });
      return res.status(403).json({ success: false, error: 'Account is inactive. Contact your manager.' });
    }
    const isMatch = await staff.matchPassword(password);
    if (!isMatch) {
      await LoginAttempt.create({ email, userId: staff._id, userName: staff.name, role: 'staff', status: 'failed', reason: 'Wrong password', ...loginInfo });
      await recordFailedLogin(email);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    staff.lastLogin = new Date();
    staff.loginHistory = [...(staff.loginHistory || []), new Date()].slice(-50);
    await staff.save();

    await LoginAttempt.create({ email, userId: staff._id, userName: staff.name, role: 'staff', status: 'success', ...loginInfo });

    await clearLoginAttempts(email);

    const refreshToken = await issueRefreshToken(staff, 'staff', { ip, userAgent });
    const token = signAccessToken({ id: staff._id, type: 'staff', tv: staff.tokenVersion || 0 });
    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        role: 'staff',
        permissions: staff.permissions,
        businessId: staff.businessId,
      },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Protect all routes below ──
router.use(protect);

// ── Get current staff profile (refresh permissions) ──
router.get('/me', tenantApproved, async (req, res) => {
  try {
    if (req.user.role !== 'staff') {
      return res.status(403).json({ success: false, error: 'Staff only' });
    }
    const staff = await Staff.findById(req.user._id).select('-password');
    if (!staff) return res.status(404).json({ success: false, error: 'Staff not found' });
    res.json({
      success: true,
      user: {
        _id: staff._id,
        name: staff.name,
        email: staff.email,
        role: 'staff',
        permissions: staff.permissions,
        businessId: staff.businessId,
        status: staff.status,
      },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── List Staff (owner only) ──
router.get('/', tenantApproved, requireFeature('staff'), async (req, res) => {
  try {
    if (!['tenant', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const bizId = getBusinessId(req);
    const staff = await Staff.find({ businessId: bizId }).select('-password').sort({ createdAt: -1 });

    const Order = require('../models/Order');
    const Product = require('../models/Product');
    const Purchase = require('../models/Purchase');
    const Debt = require('../models/Debt');
    const Expense = require('../models/Expense');

    const aggregateBy = (Model, extra = {}) =>
      Model.aggregate([
        { $match: { businessId: bizId, ...extra } },
        { $group: { _id: { $ifNull: ['$recordedBy', 'Owner'] }, count: { $sum: 1 } } },
      ]);

    const [orderAgg, productAgg, purchaseAgg, debtAgg, expenseAgg] = await Promise.all([
      aggregateBy(Order, { deletedAt: null }),
      aggregateBy(Product),
      aggregateBy(Purchase),
      aggregateBy(Debt, { deletedAt: null }),
      aggregateBy(Expense),
    ]);

    const toMap = (agg) => Object.fromEntries(agg.map((x) => [x._id, x.count]));
    const counts = {
      orders: toMap(orderAgg),
      products: toMap(productAgg),
      purchases: toMap(purchaseAgg),
      debt: toMap(debtAgg),
      expenses: toMap(expenseAgg),
    };

    const staffWithStats = staff.map((s) => {
      const n = s.name;
      return {
        ...s.toObject(),
        counts: {
          orders: counts.orders[n] || 0,
          products: counts.products[n] || 0,
          purchases: counts.purchases[n] || 0,
          debt: counts.debt[n] || 0,
          expenses: counts.expenses[n] || 0,
        },
      };
    });

    const ownerCounts = {
      orders: counts.orders['Owner'] || 0,
      products: counts.products['Owner'] || 0,
      purchases: counts.purchases['Owner'] || 0,
      debt: counts.debt['Owner'] || 0,
      expenses: counts.expenses['Owner'] || 0,
    };

    res.json({ success: true, staff: staffWithStats, ownerCounts });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Create Staff (owner only) ──
router.post('/', tenantApproved, requireFeature('staff'), enforceLimit('staff'), validate(schemas.staffCreateSchema), async (req, res) => {
  try {
    if (!['tenant', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
    }
    const bizId = getBusinessId(req);
    const existing = await Staff.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }
    const staff = await Staff.create({
      name,
      email,
      password,
      businessId: bizId,
      permissions: permissions || [],
      createdBy: req.user._id,
    });
    const staffObj = staff.toObject();
    delete staffObj.password;
    res.status(201).json({ success: true, staff: staffObj });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Update Staff (owner only) ──
router.put('/:id', tenantApproved, requireFeature('staff'), validate(schemas.staffUpdateSchema), async (req, res) => {
  try {
    if (!['tenant', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const bizId = getBusinessId(req);
    const staff = await Staff.findOne({ _id: req.params.id, businessId: bizId });
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }
    const { name, email, permissions, status } = req.body;
    if (name) staff.name = name;
    if (email) staff.email = email;
    if (permissions !== undefined) staff.permissions = permissions;
    if (status) staff.status = status;
    await staff.save();
    const staffObj = staff.toObject();
    delete staffObj.password;
    res.json({ success: true, staff: staffObj });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Reset Staff Password (owner only) ──
router.put('/:id/reset-password', tenantApproved, requireFeature('staff'), validate(schemas.staffResetSchema), async (req, res) => {
  try {
    if (!['tenant', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const bizId = getBusinessId(req);
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }
    const staff = await Staff.findOne({ _id: req.params.id, businessId: bizId });
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }
    staff.password = password;
    staff.tokenVersion = (staff.tokenVersion || 0) + 1;
    await staff.save();
    await revokeAllForUser(staff._id, 'staff');

    // Email the staff member their new password (parallel)
    if (staff.email) {
      sendEmail({
        to: staff.email,
        subject: 'Your UZANITE staff password was reset',
        html: `<h2 style="margin:0 0 12px;color:#16a34a;">Staff Password Reset</h2>
<p>Hello ${escapeHtml(staff.name)},</p>
<p>Your password for the UZANITE staff account (<strong>${escapeHtml(staff.email)}</strong>) was reset by your business owner.</p>
<p>For security, the new password is not included in this email. Please ask your business owner for it, then change it after logging in.</p>`,
      }).catch(() => {});
    }

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Delete Staff (owner only) ──
router.delete('/:id', tenantApproved, requireFeature('staff'), async (req, res) => {
  try {
    if (!['tenant', 'sub_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const bizId = getBusinessId(req);
    const staff = await Staff.findOneAndDelete({ _id: req.params.id, businessId: bizId });
    if (!staff) {
      return res.status(404).json({ success: false, error: 'Staff not found' });
    }
    res.json({ success: true, message: 'Staff deleted' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
