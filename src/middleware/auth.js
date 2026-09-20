const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Staff = require('../models/Staff');
const { jwtSecret: JWT_SECRET } = require('../config/env');
const { signAccessToken } = require('../services/tokenService');
const { setTenant } = require('../context/tenantContext');
const kv = require('../lib/kvStore');

// Short-lived access token carrying the user's token version for revocation.
const generateToken = (userId, tokenVersion = 0, extra = {}) => {
  return signAccessToken({ id: userId, tv: tokenVersion, ...extra });
};

// Password complexity validation
function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least 1 number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least 1 special character');
  return errors;
}

// Account lockout tracking. Backed by Redis when configured so limits are
// shared across API instances; falls back to in-memory for dev/tests.
const LOCK_PREFIX = 'lockout:';

// Failures are counted within a 30-minute sliding window. The lock duration
// escalates as the failure count within that window grows:
//   5  failures -> 5 min
//   8  failures -> 15 min
//   11 failures -> 30 min
//   14 failures -> 2 hr
//   17 failures -> 6 hr
//   20 failures -> 24 hr
const LOCK_WINDOW = 30 * 60 * 1000;
const LOCKOUT_SCHEDULE = [
  { count: 5,  duration: 5 * 60 * 1000 },
  { count: 8,  duration: 15 * 60 * 1000 },
  { count: 11, duration: 30 * 60 * 1000 },
  { count: 14, duration: 2 * 60 * 60 * 1000 },
  { count: 17, duration: 6 * 60 * 60 * 1000 },
  { count: 20, duration: 24 * 60 * 60 * 1000 },
];

function failureCount(record) {
  if (!record || !record.history) return 0;
  const cutoff = Date.now() - LOCK_WINDOW;
  return record.history.filter((ts) => ts >= cutoff).length;
}

async function checkLoginLockout(email) {
  const key = LOCK_PREFIX + String(email).toLowerCase();
  const record = await kv.get(key);
  if (!record) return { locked: false, attempts: 0 };
  if (record.lockedUntil && Date.now() > record.lockedUntil) {
    // Lock expired: allow attempts again but keep history so escalation continues.
    record.lockedUntil = null;
    await kv.set(key, record, LOCK_WINDOW / 1000);
    return { locked: false, attempts: failureCount(record) };
  }
  return {
    locked: !!record.lockedUntil,
    attempts: failureCount(record),
    lockedUntil: record.lockedUntil,
  };
}

async function recordFailedLogin(email) {
  const key = LOCK_PREFIX + String(email).toLowerCase();
  const record = (await kv.get(key)) || { history: [] };
  record.history = (record.history || []).filter((ts) => ts >= Date.now() - LOCK_WINDOW);
  record.history.push(Date.now());
  const count = record.history.length;

  let duration = null;
  for (const step of LOCKOUT_SCHEDULE) {
    if (count >= step.count) duration = step.duration;
  }
  if (duration && !record.lockedUntil) {
    record.lockedUntil = Date.now() + duration;
  }
  await kv.set(key, record, LOCK_WINDOW / 1000);
  return record;
}

async function clearLoginAttempts(email) {
  await kv.del(LOCK_PREFIX + String(email).toLowerCase());
}

// Protect routes - require valid JWT
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type === 'staff') {
      req.user = await Staff.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Staff not found' });
      }
      if ((decoded.tv || 0) !== (req.user.tokenVersion || 0)) {
        return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' });
      }
      req.user.role = 'staff';
    } else {
      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'User not found' });
      }
      if ((decoded.tv || 0) !== (req.user.tokenVersion || 0)) {
        return res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' });
      }
    }

    // Impersonation context. An impersonation token carries `act` (the acting
    // admin) and the subset of tenant page permissions that admin holds, so
    // downstream handlers and audit logs can tell a real tenant session apart
    // from a staff member acting as one.
    if (decoded.imp) {
      req.impersonation = {
        active: true,
        actorId: decoded.act || null,
        actorEmail: decoded.actEmail || '',
        pagePerms: Array.isArray(decoded.pagePerms) ? decoded.pagePerms : [],
      };
    }

    // Establish the tenant context for the tenantScope plugin.
    if (req.user.role === 'super_admin' || req.user.role === 'sub_admin') {
      const target = (req.query && req.query.businessId) || (req.params && req.params.businessId) || null;
      setTenant({ businessId: target, bypass: !target });
    } else {
      setTenant({ businessId: req.user.businessId || null, bypass: !req.user.businessId });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Not authorized, token failed' });
  }
};

// Admin only (super_admin + sub_admin with permissions)
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    next();
  } else if (req.user && req.user.role === 'sub_admin') {
    if (req.user.suspended) {
      return res.status(403).json({ success: false, error: 'Your account has been suspended.' });
    }
    next();
  } else {
    return res.status(403).json({ success: false, error: 'Access denied. Admin only.' });
  }
};

// Super admin only — used to gate sub-admin management (audit finding V5).
const superAdminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') return next();
  return res.status(403).json({ success: false, error: 'Access denied. Super admin only.' });
};

// Maps a tenant data route to the sub-admin page permission required to use it.
// Sub-admins must hold the matching permission server-side (audit finding V6).
const SUB_ADMIN_ROUTE_PERMISSION_MAP = {
  '/api/dashboard': 'view_dashboard',
  '/api/orders': 'manage_orders',
  '/api/products': 'manage_products',
  '/api/contacts': 'manage_contacts',
  '/api/businesses': 'manage_business',
  '/api/whatsapp': 'manage_whatsapp',
  '/api/chat': 'manage_whatsapp',
  '/api/broadcast': 'manage_broadcast',
  '/api/expenses': 'manage_expenses',
  '/api/debts': 'manage_debts',
  '/api/purchases': 'manage_purchases',
  '/api/notifications': 'manage_notifications',
  '/api/recycle-bin': 'access_recycle_bin',
  '/api/reports': 'view_reports',
  '/api/staff': 'manage_staff',
};

// Auto route-to-permission mapping for staff
const ROUTE_PERMISSION_MAP = {
  '/api/dashboard': 'dashboard',
  '/api/orders': 'orders',
  '/api/products': 'products',
  '/api/contacts': 'contacts',
  '/api/businesses': 'business',
  '/api/whatsapp': 'whatsapp',
  '/api/broadcast': 'broadcast',
  '/api/chat': 'whatsapp',
  '/api/expenses': 'expenses',
  '/api/debts': 'debts',
  '/api/purchases': 'purchases',
  '/api/notifications': 'notifications',
  '/api/recycle-bin': 'recycleBin',
  '/api/reports': 'reports',
};

// Approved tenant only (also enforces staff permissions)
const tenantApproved = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  if (req.user && req.user.role === 'sub_admin') {
    if (req.user.suspended) {
      return res.status(403).json({ success: false, error: 'Your account has been suspended.' });
    }
    const path = req.originalUrl.split('?')[0];
    const perms = req.user.permissions || [];
    for (const [route, permission] of Object.entries(SUB_ADMIN_ROUTE_PERMISSION_MAP)) {
      if (path.startsWith(route)) {
        if (perms.includes(permission)) return next();
        return res.status(403).json({ success: false, error: `Access denied. You do not have permission for ${permission}.` });
      }
    }
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  if (req.user && req.user.role === 'tenant' && req.user.status === 'approved') {
    return next();
  }
  if (req.user && req.user.role === 'staff' && req.user.status === 'active') {
    const path = req.originalUrl.split('?')[0];
    const perms = req.user.permissions || [];
    // Staff who can manage orders need read-only access to the product list
    // (POS / manual order entry lists products to add to an order).
    if (req.method === 'GET' && path.startsWith('/api/products') && perms.includes('orders')) {
      return next();
    }
    for (const [route, permission] of Object.entries(ROUTE_PERMISSION_MAP)) {
      if (path.startsWith(route)) {
        if (req.user.permissions && req.user.permissions.includes(permission)) {
          return next();
        }
        return res.status(403).json({ success: false, error: `Access denied. You do not have permission for ${permission}.` });
      }
    }
    return res.status(403).json({ success: false, error: 'Access denied.' });
  }
  return res.status(403).json({ success: false, error: 'Account not approved yet. Contact admin.' });
};

// Sub-admin permission checker
const SUB_ADMIN_PERMISSIONS = {
  // Tenant Management (Admin Panel)
  'view_tenants': 'View Tenants',
  'approve_tenants': 'Approve / Reject Tenants',
  'suspend_tenants': 'Suspend / Unsuspend Tenants',
  'impersonate_tenants': 'Impersonate Tenants',
  'edit_tenants': 'Edit Tenant Name / Email',
  'reset_tenant_passwords': 'Reset Tenant Passwords',
  'delete_tenants': 'Delete Tenants',
  // Tenant Page Access (only relevant with impersonate_tenants)
  'view_dashboard': 'View Dashboard',
  'manage_orders': 'Manage Orders',
  'manage_products': 'Manage Products',
  'manage_contacts': 'Manage Contacts',
  'manage_whatsapp': 'Manage WhatsApp',
  'manage_broadcast': 'Manage Broadcast',
  'manage_expenses': 'Manage Expenses',
  'manage_purchases': 'Manage Purchases',
  'manage_debts': 'Manage Debts',
  'manage_staff': 'Manage Staff',
  'manage_business': 'Manage Business',
  'manage_settings': 'Manage Settings',
  'manage_notifications': 'Manage Notifications',
  'view_reports': 'View Reports',
  'access_recycle_bin': 'Access Recycle Bin',
};

// Tenant management action permissions (all require view_tenants)
const TENANT_ACTION_PERMS = ['approve_tenants', 'suspend_tenants', 'impersonate_tenants', 'edit_tenants', 'reset_tenant_passwords', 'delete_tenants'];

// Tenant page permissions (only relevant when impersonating)
const TENANT_PAGE_PERMS = ['view_dashboard', 'manage_orders', 'manage_products', 'manage_contacts', 'manage_whatsapp', 'manage_broadcast', 'manage_expenses', 'manage_purchases', 'manage_debts', 'manage_staff', 'manage_business', 'manage_settings', 'manage_notifications', 'view_reports', 'access_recycle_bin'];

const subAdminPermission = (permission) => {
  return (req, res, next) => {
    if (req.user && req.user.role === 'super_admin') {
      return next();
    }
    if (req.user && req.user.role === 'sub_admin') {
      if (req.user.suspended) {
        return res.status(403).json({ success: false, error: 'Your account has been suspended.' });
      }
      if (req.user.permissions && req.user.permissions.includes(permission)) {
        return next();
      }
      return res.status(403).json({ success: false, error: `Access denied. You need "${permission}" permission.` });
    }
    return res.status(403).json({ success: false, error: 'Access denied.' });
  };
};

/**
 * Restricts an impersonated session to the page permissions the acting admin
 * actually holds. `TENANT_PAGE_PERMS` was defined in this file from the start
 * but never enforced, so any admin who could impersonate got the tenant's full
 * privileges regardless of their own permission set.
 *
 * A normal (non-impersonated) tenant session passes straight through.
 */
const requireTenantPage = (pagePermission) => (req, res, next) => {
  const imp = req.impersonation;
  if (!imp || !imp.active) return next();
  if (imp.pagePerms.includes(pagePermission)) return next();
  return res.status(403).json({
    success: false,
    error: `Impersonation denied: you do not hold the "${pagePermission}" permission.`,
    impersonation: true,
  });
};

module.exports = {
  protect,
  requireTenantPage,
  adminOnly,
  superAdminOnly,
  tenantApproved,
  generateToken,
  JWT_SECRET,
  validatePassword,
  checkLoginLockout,
  recordFailedLogin,
  clearLoginAttempts,
  subAdminPermission,
  SUB_ADMIN_PERMISSIONS,
  TENANT_ACTION_PERMS,
  TENANT_PAGE_PERMS,
};
