const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ChatContact = require('../models/ChatContact');
const { sendEmail } = require('../services/emailService');
const { protect, adminOnly, superAdminOnly, generateToken, subAdminPermission, validatePassword, SUB_ADMIN_PERMISSIONS, TENANT_ACTION_PERMS, TENANT_PAGE_PERMS } = require('../middleware/auth');
const { getEffectiveFlags } = require('./featureFlags');
const { escapeHtml } = require('../utils/escapeHtml');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { revokeAllForUser } = require('../services/tokenService');
const ActivityLog = require('../models/ActivityLog');
const logger = require('../config/logger');
const { sendServerError } = require('../utils/safeError');
const { escapeRegex } = require('../utils/escapeRegex');

// Impersonation sessions are deliberately short: long enough to diagnose a
// tenant's problem, short enough that a leaked token has little value.
const IMPERSONATION_TTL_SECONDS = 30 * 60;

// Records a privileged admin action against a tenant. Logged unconditionally so
// the action is on the record even if the audit write fails.
async function writeAdminAudit(req, action, targetUser, detail = {}) {
  const actor = req.user || {};
  logger.warn(
    {
      audit: action,
      actorId: String(actor._id || ''),
      actorEmail: actor.email || '',
      targetUserId: String(targetUser?._id || ''),
      businessId: targetUser?.businessId || '',
      ip: req.ip || '',
      ...detail,
    },
    `admin-audit ${action}`
  );
  try {
    await ActivityLog.create({
      userId: actor._id,
      userName: actor.name || '',
      userEmail: actor.email || '',
      page: 'admin',
      action: 'visit',
      businessId: targetUser?.businessId || 'default',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      referrer: `${action}:${String(targetUser?._id || '')}`,
    });
  } catch (err) {
    logger.error({ err: err.message }, `Failed to persist admin audit for ${action}`);
  }
}

// All routes require super admin or sub admin auth
router.use(protect, adminOnly);

// Helper: check sub-admin permission (super admin bypasses)
// view_tenants is prerequisite for all tenant management actions
const requirePerm = (permission) => (req, res, next) => {
  if (req.user.role === 'super_admin') return next();
  if (req.user.role === 'sub_admin') {
    if (req.user.suspended) return res.status(403).json({ success: false, error: 'Account suspended' });
    const perms = req.user.permissions || [];
    // view_tenants is required before any tenant action
    if (TENANT_ACTION_PERMS.includes(permission) && !perms.includes('view_tenants')) {
      return res.status(403).json({ success: false, error: 'Missing permission: view_tenants' });
    }
    if (perms.includes(permission)) return next();
    return res.status(403).json({ success: false, error: `Missing permission: ${permission}` });
  }
  return res.status(403).json({ success: false, error: 'Access denied' });
};

// GET /api/admin/users — list all tenant users
router.get('/users', requirePerm('view_tenants'), async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = { role: 'tenant', deletedAt: null };

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query.status = status;
    }
    if (search) {
      const rx = escapeRegex(search);
      query.$or = [
        { name: { $regex: rx, $options: 'i' } },
        { email: { $regex: rx, $options: 'i' } },
        { businessName: { $regex: rx, $options: 'i' } },
      ];
    }

    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    // Include business metrics (never credentials — audit finding V2).
    const usersWithDetails = await Promise.all(users.map(async (u) => {
      const bid = u.businessId || 'default';
      const [totalOrders, totalRevenue, productCount, contactCount] = await Promise.all([
        Order.countDocuments({ businessId: bid }),
        Order.aggregate([{ $match: { businessId: bid, status: 'PAID' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
        Product.countDocuments({ businessId: bid }),
        ChatContact.countDocuments({ businessId: bid }),
      ]);
      return {
        ...u.toObject(),
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        productCount,
        contactCount,
      };
    }));
    const counts = {
      total: await User.countDocuments({ role: 'tenant' }),
      pending: await User.countDocuments({ role: 'tenant', status: 'pending' }),
      approved: await User.countDocuments({ role: 'tenant', status: 'approved' }),
      rejected: await User.countDocuments({ role: 'tenant', status: 'rejected' }),
    };

    res.json({ success: true, counts, users: usersWithDetails });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/approve — approve a tenant
router.put('/users/:id/approve', requirePerm('approve_tenants'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (user.role !== 'tenant') {
      return res.status(400).json({ success: false, error: 'Cannot approve admin accounts' });
    }

    user.status = 'approved';
    user.approvedAt = new Date();
    user.approvedBy = req.user._id;
    await user.save();

    const { createNotification } = require('../services/notificationStore');
    createNotification({
      businessId: user.businessId,
      type: 'account_approved',
      title: 'Account Approved',
      message: `Congratulations! Your account "${user.businessName || user.name}" has been approved. You can now use all features.`,
      data: { userId: user._id.toString() },
      priority: 'high',
    });

    // Email the tenant (parallel to WhatsApp/notification)
    sendEmail({
      to: user.email,
      subject: 'Your UZANITE account has been approved',
      html: `<h2 style="margin:0 0 12px;color:#16a34a;">Account Approved 🎉</h2>
<p>Hello ${escapeHtml(user.name)},</p>
<p>Congratulations! Your account <strong>"${escapeHtml(user.businessName || user.name)}"</strong> has been approved by our admin team.</p>
<p>You can now log in and use all features of UZANITE.</p>
<p style="margin-top:24px;"><a href="${process.env.APP_URL || ''}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Log in to UZANITE</a></p>
<p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy this link: ${process.env.APP_URL || ''}</p>`,
    }).catch(() => {});

    res.json({
      success: true,
      message: `User ${user.name} approved successfully`,
      user: { id: user._id, name: user.name, email: user.email, status: user.status },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/reject — reject a tenant
router.put('/users/:id/reject', requirePerm('approve_tenants'), validate(schemas.adminRejectSchema), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (user.role !== 'tenant') {
      return res.status(400).json({ success: false, error: 'Cannot reject admin accounts' });
    }

    const reason = (req.body && req.body.reason ? String(req.body.reason).trim() : '') || 'No reason was provided.';
    user.status = 'rejected';
    user.rejectionReason = reason;
    await user.save();

    const { createNotification } = require('../services/notificationStore');
    createNotification({
      businessId: user.businessId,
      type: 'account_rejected',
      title: 'Account Rejected',
      message: `Your account "${user.businessName || user.name}" has been rejected. Reason: ${reason}`,
      data: { userId: user._id.toString(), reason },
      priority: 'high',
    });

    // Email the tenant with the rejection reason (parallel to notification)
    sendEmail({
      to: user.email,
      subject: 'Your UZANITE account application was rejected',
      html: `<h2 style="margin:0 0 12px;color:#dc2626;">Account Rejected</h2>
<p>Hello ${escapeHtml(user.name)},</p>
<p>We're sorry to inform you that your account <strong>"${escapeHtml(user.businessName || user.name)}"</strong> was not approved at this time.</p>
<p><strong>Reason from our team:</strong></p>
<blockquote style="border-left:4px solid #dc2626;margin:0;padding:8px 16px;background:#fef2f2;color:#7f1d1d;">${escapeHtml(reason)}</blockquote>
<p>If you believe this was a mistake, please contact our support team.</p>`,
    }).catch(() => {});

    res.json({
      success: true,
      message: `User ${user.name} rejected`,
      user: { id: user._id, name: user.name, email: user.email, status: user.status, rejectionReason: reason },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/admin/users/:id — soft delete a tenant (move to recycle bin)
router.delete('/users/:id', requirePerm('delete_tenants'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (req.query.permanent === 'true') {
      await User.findByIdAndDelete(req.params.id);
      return res.json({ success: true, message: 'User permanently deleted' });
    }
    user.deletedAt = new Date();
    user.deletedBy = req.user._id;
    user.status = 'rejected';
    await user.save();
    res.json({ success: true, message: 'User moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/restore — restore tenant from recycle bin
router.put('/users/:id/restore', requirePerm('delete_tenants'), async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, deletedAt: { $ne: null } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found in recycle bin' });
    }
    user.deletedAt = undefined;
    user.deletedBy = undefined;
    user.status = 'pending';
    await user.save();
    res.json({ success: true, message: 'User restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/reset-password — reset a tenant's password
router.put('/users/:id/reset-password', requirePerm('reset_tenant_passwords'), validate(schemas.adminResetSchema), async (req, res) => {
  try {
    const { newPassword } = req.body;
    const pwErrors = validatePassword(newPassword || '');
    if (pwErrors.length) {
      return res.status(400).json({ success: false, error: `Weak password: ${pwErrors.join(', ')}` });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.password = newPassword;
    user.mustChangePassword = true;
    // SECURITY: revoke every existing session. Without this, an admin resetting
    // a compromised account changed the password while the attacker's access
    // token (valid up to its TTL) and refresh token kept working — so the
    // standard remediation did not actually lock the attacker out.
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await revokeAllForUser(user._id, 'user');

    await writeAdminAudit(req, 'admin.password_reset', user, {
      targetEmail: user.email,
      sessionsRevoked: true,
    });

    res.json({
      success: true,
      message: `Password reset for ${user.name}. All existing sessions were signed out.`,
      sessionsRevoked: true,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/update-name — change a tenant's name
router.put('/users/:id/update-name', requirePerm('edit_tenants'), validate(schemas.adminNameSchema), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.name = name.trim();
    await user.save();

    res.json({
      success: true,
      message: `Name updated to "${user.name}"`,
      user: { id: user._id, name: user.name },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/update-email — change a tenant's email
router.put('/users/:id/update-email', requirePerm('edit_tenants'), validate(schemas.adminEmailSchema), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const existing = await User.findOne({ email: trimmed, _id: { $ne: req.params.id } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.email = trimmed;
    await user.save();

    res.json({
      success: true,
      message: `Email updated to "${user.email}"`,
      user: { id: user._id, email: user.email },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/suspend — suspend/unsuspend a user
router.put('/users/:id/suspend', requirePerm('suspend_tenants'), validate(schemas.adminSuspendSchema), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (user.role === 'super_admin') {
      return res.status(400).json({ success: false, error: 'Cannot suspend super admin' });
    }

    const { suspended } = req.body;
    user.suspended = !!suspended;
    await user.save();

    res.json({
      success: true,
      message: suspended ? `${user.name} has been suspended` : `${user.name} has been unsuspended`,
      user: { id: user._id, name: user.name, suspended: user.suspended },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/admin/stats — super admin dashboard stats
router.get('/stats', requirePerm('view_tenants'), async (req, res) => {
  try {
    const stats = {
      totalUsers: await User.countDocuments({ role: 'tenant' }),
      pendingUsers: await User.countDocuments({ role: 'tenant', status: 'pending' }),
      approvedUsers: await User.countDocuments({ role: 'tenant', status: 'approved' }),
      rejectedUsers: await User.countDocuments({ role: 'tenant', status: 'rejected' }),
      connectedWhatsApp: await User.countDocuments({ role: 'tenant', whatsappConnected: true }),
    };
    res.json({ success: true, stats });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/admin/impersonate/:id — impersonate a tenant
router.post('/impersonate/:id', requirePerm('impersonate_tenants'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.role !== 'tenant') return res.status(400).json({ success: false, error: 'Can only impersonate tenants' });
    if (user.status !== 'approved') return res.status(400).json({ success: false, error: 'Cannot impersonate unapproved tenants' });

    // SECURITY: an impersonation token must be distinguishable from the
    // tenant's own token, short-lived, and auditable. Previously this minted a
    // full-privilege tenant token with tv=0, no actor claim and no audit row —
    // so staff access to a tenant's data was untraceable, and the token stayed
    // valid even after the tenant rotated their sessions.
    const actingAdmin = req.user;
    const grantedPagePerms =
      actingAdmin.role === 'super_admin'
        ? TENANT_PAGE_PERMS
        : (actingAdmin.permissions || []).filter((perm) => TENANT_PAGE_PERMS.includes(perm));

    const token = generateToken(user._id, user.tokenVersion || 0, {
      act: String(actingAdmin._id),
      actEmail: actingAdmin.email,
      imp: true,
      pagePerms: grantedPagePerms,
      exp: Math.floor(Date.now() / 1000) + IMPERSONATION_TTL_SECONDS,
    });

    const featureFlags = await getEffectiveFlags(user._id).catch(() => ({}));

    await writeAdminAudit(req, 'admin.impersonate', user, {
      targetEmail: user.email,
      businessId: user.businessId,
      pagePerms: grantedPagePerms,
      expiresInSeconds: IMPERSONATION_TTL_SECONDS,
    });

    res.json({
      success: true,
      token,
      impersonation: {
        active: true,
        by: actingAdmin.email,
        expiresInSeconds: IMPERSONATION_TTL_SECONDS,
        pagePermissions: grantedPagePerms,
      },
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, businessId: user.businessId, status: user.status, featureFlags, theme: user.theme || 'light' },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// ── Sub-Admin Management ────────────────────────────────────────────────

// GET /api/admin/sub-admins — list all sub-admins
router.get('/sub-admins', requirePerm('view_tenants'), async (req, res) => {
  try {
    const users = await User.find({ role: 'sub_admin', deletedAt: null })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json({ success: true, users, permissions: SUB_ADMIN_PERMISSIONS });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/admin/sub-admins — create a sub-admin (super admin only, audit V5)
router.post('/sub-admins', superAdminOnly, validate(schemas.subAdminCreateSchema), async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });
    }
    const pwErrors = validatePassword(password);
    if (pwErrors.length) {
      return res.status(400).json({ success: false, error: `Weak password: ${pwErrors.join(', ')}` });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    const validPerms = (permissions || []).filter(p => SUB_ADMIN_PERMISSIONS[p]);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: 'sub_admin',
      status: 'approved',
      permissions: validPerms,
      mustChangePassword: true,
    });

    res.status(201).json({
      success: true,
      message: `Sub-admin "${user.name}" created`,
      user: { id: user._id, name: user.name, email: user.email, permissions: user.permissions },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/sub-admins/:id — update sub-admin (super admin only)
router.put('/sub-admins/:id', superAdminOnly, validate(schemas.subAdminUpdateSchema), async (req, res) => {
  try {
    const { name, email, permissions } = req.body;
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'sub_admin') {
      return res.status(404).json({ success: false, error: 'Sub-admin not found' });
    }

    if (name) user.name = name.trim();
    if (email) {
      const trimmed = email.trim().toLowerCase();
      const dup = await User.findOne({ email: trimmed, _id: { $ne: req.params.id } });
      if (dup) return res.status(400).json({ success: false, error: 'Email already in use' });
      user.email = trimmed;
    }
    if (permissions) {
      user.permissions = permissions.filter(p => SUB_ADMIN_PERMISSIONS[p]);
    }

    await user.save();
    res.json({ success: true, message: `Sub-admin updated`, user: { id: user._id, name: user.name, email: user.email, permissions: user.permissions } });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/admin/sub-admins/:id — delete sub-admin (super admin only)
router.delete('/sub-admins/:id', superAdminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'sub_admin') {
      return res.status(404).json({ success: false, error: 'Sub-admin not found' });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Sub-admin "${user.name}" deleted` });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/users/:id/plan — set a tenant's plan/subscription (super admin only)
router.put('/users/:id/plan', superAdminOnly, validate(schemas.billingPlanSchema), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'tenant') {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    user.plan = req.body.plan;
    if (req.body.subscriptionStatus) user.subscriptionStatus = req.body.subscriptionStatus;
    if (req.body.trialEndsAt !== undefined) {
      user.trialEndsAt = req.body.trialEndsAt ? new Date(req.body.trialEndsAt) : null;
    }
    if (req.body.currentPeriodEnd !== undefined) {
      user.currentPeriodEnd = req.body.currentPeriodEnd ? new Date(req.body.currentPeriodEnd) : null;
    }
    await user.save();
    res.json({
      success: true,
      user: { id: user._id, plan: user.plan, subscriptionStatus: user.subscriptionStatus },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/admin/sub-admins/:id/reset-password — reset sub-admin password (super admin only)
router.put('/sub-admins/:id/reset-password', superAdminOnly, validate(schemas.adminResetSchema), async (req, res) => {
  // Same session-revocation requirement as tenant resets (see above).
  try {
    const { newPassword } = req.body;
    const pwErrors = validatePassword(newPassword || '');
    if (pwErrors.length) {
      return res.status(400).json({ success: false, error: `Weak password: ${pwErrors.join(', ')}` });
    }
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'sub_admin') {
      return res.status(404).json({ success: false, error: 'Sub-admin not found' });
    }
    user.password = newPassword;
    user.mustChangePassword = true;
    await user.save();
    res.json({ success: true, message: `Password reset for ${user.name}` });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;