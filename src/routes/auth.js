const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Staff = require('../models/Staff');
const LoginAttempt = require('../models/LoginAttempt');
const { generateToken, protect, checkLoginLockout, recordFailedLogin, clearLoginAttempts, validatePassword } = require('../middleware/auth');
const { parseUserAgent } = require('../middleware/activity');
const { sendEmail } = require('../services/emailService');
const { getEffectiveFlags } = require('../services/featureFlagService');
const {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  signAccessToken,
} = require('../services/tokenService');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { escapeHtml } = require('../utils/escapeHtml');
const crypto = require('crypto');
const { sendServerError } = require('../utils/safeError');

// Attach effective feature flags to a tenant user object (no-op for non-tenants).
async function withFeatureFlags(userObj) {
  if (userObj.role === 'tenant') {
    try {
      userObj.featureFlags = await getEffectiveFlags(userObj.id);
    } catch {
      userObj.featureFlags = {};
    }
  }
  return userObj;
}

// Send a one-time-per-day email nudge when a user logs in with an unverified account
async function sendUnverifiedLoginEmail(user) {
  try {
    const now = Date.now();
    if (user.lastUnverifiedEmailAt && now - new Date(user.lastUnverifiedEmailAt).getTime() < 24 * 3600 * 1000) {
      return;
    }
    user.lastUnverifiedEmailAt = new Date();
    user.save({ validateBeforeSave: false }).catch(() => {});

    const needsWhatsApp = !user.whatsappConnected;
    sendEmail({
      to: user.email,
      subject: 'Action needed: complete your UZANITE account',
      html: `<h2 style="margin:0 0 12px;color:#16a34a;">Complete Your Registration</h2>
<p>Hello ${escapeHtml(user.name)},</p>
<p>You tried to sign in to UZANITE, but your account is not yet fully verified:</p>
<ul>
  <li><strong>WhatsApp connection:</strong> ${needsWhatsApp ? 'Not connected — please connect your WhatsApp number.' : 'Connected ✅'}</li>
  <li><strong>Admin approval:</strong> ${needsWhatsApp ? 'Pending (after WhatsApp is connected).' : 'Pending — awaiting admin approval.'}</li>
</ul>
<p>Once verified, you'll be able to use all UZANITE features.</p>
<p style="margin-top:24px;"><a href="${process.env.APP_URL || ''}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Go to UZANITE</a></p>`,
    }).catch(() => {});
  } catch (_) {
    /* never block login on email failure */
  }
}

function humanDuration(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hrs = Math.ceil(ms / 3600000);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'}`;
  const days = Math.ceil(ms / 86400000);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function getLoginInfo(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || '';
  const { device, browser, os } = parseUserAgent(userAgent);
  return { ip, userAgent, device, browser, os };
}

// POST /api/auth/register — register a new tenant account
router.post('/register', validate(schemas.registerSchema), async (req, res) => {
  try {
    const { name, email, password, phone, businessName } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email and password are required' });
    }

    const pwErrors = validatePassword(password);
    if (pwErrors.length) {
      return res.status(400).json({ success: false, error: `Weak password: ${pwErrors.join(', ')}` });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }

    // Generate unique business ID
    const businessId = 'biz_' + crypto.randomBytes(6).toString('hex');

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || '',
      businessName: businessName || name + "'s Shop",
      businessId,
      sessionId: businessId,
      role: 'tenant',
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please login and connect your WhatsApp number. After scanning, your details will be sent to the admin for approval.',
      nextStep: 'whatsapp_verification',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        businessId: user.businessId,
        role: user.role,
        status: user.status,
      },
    });

    // Welcome email (parallel, never blocks the response)
    sendEmail({
      to: user.email,
      subject: 'Welcome to UZANITE — next steps',
      html: `<h2 style="margin:0 0 12px;color:#16a34a;">Welcome to UZANITE, ${escapeHtml(user.name)}!</h2>
<p>Thanks for registering <strong>"${escapeHtml(user.businessName || user.name)}"</strong>.</p>
<p>To activate your account:</p>
<ol>
  <li>Log in and connect your WhatsApp number.</li>
  <li>Wait for admin approval (we'll email you when approved).</li>
</ol>
<p style="margin-top:24px;"><a href="${process.env.APP_URL || ''}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Get started</a></p>`,
    }).catch(() => {});
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/login — login and get token
router.post('/login', validate(schemas.loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const loginInfo = getLoginInfo(req);

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
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

    const user = await User.findOne({ email });
    if (!user) {
      await LoginAttempt.create({ email, status: 'failed', reason: 'User not found', ...loginInfo });
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'failed', reason: 'Wrong password', ...loginInfo });
      await recordFailedLogin(email);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    if (user.status === 'rejected') {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'rejected', reason: 'Account rejected', ...loginInfo });
      return res.status(403).json({ success: false, error: 'Your account has been rejected. Contact support.' });
    }

    if (user.suspended) {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'suspended', reason: 'Account suspended', ...loginInfo });
      return res.status(403).json({ success: false, error: 'Your account has been suspended. Contact support.' });
    }

    // Issue a short-lived access token + a rotating refresh token.
    const refreshToken = await issueRefreshToken(user, 'user', {
      ip: loginInfo.ip,
      userAgent: loginInfo.userAgent,
    });

    // For pending users, include additional info about what they need to do
    const response = {
      success: true,
      token: generateToken(user._id, user.tokenVersion || 0),
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        businessId: user.businessId,
        businessName: user.businessName,
        whatsappConnected: user.whatsappConnected,
        permissions: user.permissions || [],
        mustChangePassword: !!user.mustChangePassword,
      },
    };

    // For pending users, include additional info about what they need to do
    if (user.status === 'pending' && user.role === 'tenant') {
      response.pending = true;
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'pending', reason: 'Account pending approval', ...loginInfo });
      if (!user.whatsappConnected) {
        response.message = 'Please connect your WhatsApp to complete registration.';
        response.nextStep = 'whatsapp_verification';
      } else {
        response.message = 'Your account is pending admin approval. Please wait for approval.';
        response.nextStep = 'waiting_approval';
      }
      // Nudge the user by email (throttled to once/day)
      sendUnverifiedLoginEmail(user);
    } else {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'success', ...loginInfo });
    }

    if (user.role === 'tenant') {
      response.user.featureFlags = await getEffectiveFlags(user._id);
      response.user.theme = user.theme || 'light';
    }
    await clearLoginAttempts(email);
    res.json(response);
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/google — login or register with Google (tenant/admin or staff)
router.post('/google', validate(schemas.googleSchema), async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, error: 'Google token required' });
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Google login is not configured on the server' });
    }

    const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
    const payload = await gRes.json();
    if (!gRes.ok || payload.error || !payload.sub) {
      return res.status(401).json({ success: false, error: 'Invalid Google token' });
    }
    if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
      return res.status(401).json({ success: false, error: 'Token audience mismatch' });
    }
    if (payload.exp * 1000 < Date.now()) {
      return res.status(401).json({ success: false, error: 'Google token expired' });
    }

    const email = (payload.email || '').toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Google account has no email' });
    const name = payload.name || email.split('@')[0];
    const loginInfo = getLoginInfo(req);

    // ── Staff sign-in via Google (matched by email) ──
    const staff = await Staff.findOne({ email });
    if (staff) {
      if (staff.status !== 'active') {
        await LoginAttempt.create({ email, userId: staff._id, userName: staff.name, role: 'staff', status: 'inactive', reason: 'Staff account inactive', ...loginInfo });
        return res.status(403).json({ success: false, error: 'Account is inactive. Contact your manager.' });
      }
      if (!staff.googleId) {
        staff.googleId = payload.sub;
        staff.avatar = payload.picture || staff.avatar;
        await staff.save({ validateBeforeSave: false });
      }
      await LoginAttempt.create({ email, userId: staff._id, userName: staff.name, role: 'staff', status: 'success', ...loginInfo });
      const staffRefresh = await issueRefreshToken(staff, 'staff', { ip: loginInfo.ip, userAgent: loginInfo.userAgent });
      const token = signAccessToken({ id: staff._id, type: 'staff', tv: staff.tokenVersion || 0 });
      return res.json({
        success: true,
        token,
        refreshToken: staffRefresh,
        user: {
          _id: staff._id, name: staff.name, email: staff.email,
          role: 'staff', permissions: staff.permissions, businessId: staff.businessId,
          avatar: staff.avatar || '',
        },
      });
    }

    // ── Tenant / admin sign-in or sign-up via Google ──
    // New Google signups are created PENDING and require admin approval
    // (no one is fully registered without admin permission).
    let isNew = false;
    let user = await User.findOne({ email });
    if (!user) {
      const businessId = 'biz_' + crypto.randomBytes(6).toString('hex');
      user = await User.create({
        name,
        email,
        googleId: payload.sub,
        avatar: payload.picture || '',
        authProvider: 'google',
        businessId,
        sessionId: businessId,
        role: 'tenant',
        status: 'pending',
      });
      isNew = true;
    } else if (!user.googleId || user.authProvider === 'local') {
      user.googleId = payload.sub;
      user.avatar = payload.picture || user.avatar;
      if (user.authProvider === 'local' && !user.password) user.authProvider = 'google';
      await user.save({ validateBeforeSave: false });
    }

    if (user.status === 'rejected') {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'rejected', reason: 'Account rejected', ...loginInfo });
      return res.status(403).json({ success: false, error: 'Your account has been rejected. Contact support.' });
    }
    if (user.suspended) {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'suspended', reason: 'Account suspended', ...loginInfo });
      return res.status(403).json({ success: false, error: 'Your account has been suspended. Contact support.' });
    }

    const userObj = {
      id: user._id, name: user.name, email: user.email, role: user.role,
      status: user.status, businessId: user.businessId, businessName: user.businessName,
      whatsappConnected: user.whatsappConnected, permissions: user.permissions || [],
      avatar: user.avatar || '',
      mustChangePassword: !!user.mustChangePassword,
    };

    if (user.role === 'tenant') {
      userObj.featureFlags = await getEffectiveFlags(user._id);
      userObj.theme = user.theme || 'light';
    }

    // Pending tenants (incl. new Google signups) cannot log in until approved by admin
    if (user.status === 'pending' && user.role === 'tenant') {
      await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'pending', reason: 'Account pending approval', ...loginInfo });
      // Nudge the user by email (throttled to once/day)
      sendUnverifiedLoginEmail(user);
      return res.json({
        success: true,
        pending: true,
        message: isNew
          ? 'Registration successful! Your account is pending admin approval.'
          : 'Your account is pending admin approval. Please wait for approval.',
        nextStep: user.whatsappConnected ? 'waiting_approval' : 'whatsapp_verification',
        user: userObj,
      });
    }

    await LoginAttempt.create({ email, userId: user._id, userName: user.name, role: user.role, status: 'success', ...loginInfo });
    const refreshToken = await issueRefreshToken(user, 'user', { ip: loginInfo.ip, userAgent: loginInfo.userAgent });
    res.json({ success: true, token: generateToken(user._id, user.tokenVersion || 0), refreshToken, user: userObj });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/auth/me — get current user profile
router.get('/me', protect, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      status: req.user.status,
      businessId: req.user.businessId,
      businessName: req.user.businessName,
      phone: req.user.phone,
      whatsappConnected: req.user.whatsappConnected,
      theme: req.user.theme || 'light',
      createdAt: req.user.createdAt,
    },
  });
});

// PUT /api/auth/theme — tenant sets their UI theme preference
router.put('/theme', protect, async (req, res) => {
  try {
    if (req.user.role !== 'tenant') {
      return res.status(403).json({ success: false, error: 'Only tenant accounts can set a theme' });
    }
    const theme = req.body && req.body.theme === 'dark' ? 'dark' : 'light';
    req.user.theme = theme;
    await req.user.save();
    res.json({ success: true, theme });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/change-password — change own password and clear forced-change flag.
router.post('/change-password', protect, validate(schemas.changePasswordSchema), async (req, res) => {
  try {
    if (req.user.role === 'staff') {
      return res.status(400).json({ success: false, error: 'Staff password changes are managed by the business owner.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required' });
    }
    const pwErrors = validatePassword(newPassword);
    if (pwErrors.length) {
      return res.status(400).json({ success: false, error: `Weak password: ${pwErrors.join(', ')}` });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const ok = await user.matchPassword(currentPassword);
    if (!ok) return res.status(401).json({ success: false, error: 'Current password is incorrect' });

    user.password = newPassword;
    user.mustChangePassword = false;
    // Revoke every existing session (access tokens via tokenVersion, refresh via DB).
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await revokeAllForUser(user._id, 'user');

    // Issue a fresh session so the caller stays signed in.
    const info = getLoginInfo(req);
    const refreshToken = await issueRefreshToken(user, 'user', { ip: info.ip, userAgent: info.userAgent });
    res.json({
      success: true,
      message: 'Password updated',
      token: generateToken(user._id, user.tokenVersion),
      refreshToken,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/refresh — rotate a refresh token for a new access token pair.
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required' });

    const info = getLoginInfo(req);
    const rotated = await rotateRefreshToken(refreshToken, { ip: info.ip, userAgent: info.userAgent });
    if (!rotated) return res.status(401).json({ success: false, error: 'Invalid or expired session' });

    const Model = rotated.userType === 'staff' ? Staff : User;
    const account = await Model.findById(rotated.userId).select('-password');
    if (!account) return res.status(401).json({ success: false, error: 'Account not found' });
    if (account.suspended || (account.status && ['rejected', 'inactive'].includes(account.status))) {
      await revokeAllForUser(account._id, rotated.userType);
      return res.status(403).json({ success: false, error: 'Account is not active' });
    }

    const payload =
      rotated.userType === 'staff'
        ? { id: account._id, type: 'staff', tv: account.tokenVersion || 0 }
        : { id: account._id, tv: account.tokenVersion || 0 };

    res.json({
      success: true,
      token: signAccessToken(payload),
      refreshToken: rotated.refreshToken,
      user: {
        id: account._id,
        name: account.name,
        email: account.email,
        role: rotated.userType === 'staff' ? 'staff' : account.role,
        businessId: account.businessId,
        permissions: account.permissions || [],
      },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/logout — revoke the presented refresh token.
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) await revokeRefreshToken(refreshToken);
    res.json({ success: true, message: 'Signed out' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/forgot-password — email a single-use reset link.
router.post('/forgot-password', validate(schemas.forgotPasswordSchema), async (req, res) => {
  try {
    const email = req.body.email;
    const user = await User.findOne({ email });
    // Always return success to avoid account enumeration.
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });

    const raw = crypto.randomBytes(32).toString('hex');
    user.resetToken = crypto.createHash('sha256').update(raw).digest('hex');
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save({ validateBeforeSave: false });

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const link = `${appUrl}/admin/reset-password.html?token=${raw}`;
    await sendEmail({
      to: user.email,
      subject: 'Reset your UZANITE password',
      html: `<h2 style="margin:0 0 12px;color:#16a34a;">Password Reset</h2>
<p>Hello ${escapeHtml(user.name)},</p>
<p>We received a request to reset your password. This link expires in 1 hour.</p>
<p style="margin-top:20px;"><a href="${link}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;">Reset password</a></p>
<p style="color:#6b7280;font-size:13px;">If you did not request this, you can safely ignore this email.</p>`,
    }).catch(() => {});

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/auth/reset-password — complete a password reset with a valid token.
router.post('/reset-password', validate(schemas.resetPasswordSchema), async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetToken: hashed, resetTokenExpiry: { $gt: new Date() } });
    if (!user) return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });

    user.password = newPassword;
    user.resetToken = '';
    user.resetTokenExpiry = null;
    user.mustChangePassword = false;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();
    await revokeAllForUser(user._id, 'user');

    res.json({ success: true, message: 'Password reset successful. Please sign in.' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
