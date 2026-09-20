const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const transport = require('../whatsapp/transport');
const { pauseBot, resumeBot, isBotPaused } = require('../whatsapp/botState');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const User = require('../models/User');
const { encrypt } = require('../utils/crypto');
const QRCode = require('qrcode');
const { sendServerError } = require('../utils/safeError');

// Convert a raw WhatsApp QR string into a PNG data URL rendered server-side.
async function qrToDataUrl(qr) {
  if (!qr) return null;
  try {
    return await QRCode.toDataURL(qr, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  } catch (err) {
    console.error('QR render failed:', err.message);
    return null;
  }
}

function resolveBusinessId(req) {
  return req.user.role === 'super_admin' || req.user.role === 'sub_admin'
    ? (req.query.businessId || req.user.businessId || 'default')
    : req.user.businessId;
}

router.use(protect);

// Special handling for pending users - only allow connection-related routes.
router.use((req, res, next) => {
  if (req.user.role === 'super_admin') return next();

  if (req.user.role === 'tenant') {
    if (req.user.status === 'pending') {
      if (['/connect', '/qr', '/status'].includes(req.path) && req.method === 'GET' ||
          (req.path === '/connect' && req.method === 'POST')) {
        return next();
      }
      return res.status(403).json({
        success: false,
        error: 'Your account is pending approval. Please complete WhatsApp verification and wait for admin approval.',
        status: 'pending',
        whatsappConnected: req.user.whatsappConnected,
      });
    }
    if (req.user.status === 'rejected') {
      return res.status(403).json({ success: false, error: 'Your account has been rejected. Contact support.' });
    }
    if (req.user.status === 'approved') {
      return tenantApproved(req, res, next);
    }
  }
  next();
});

// Feature-flag gate for all WhatsApp endpoints.
router.use(requireFeature('whatsapp'));

// GET /api/whatsapp/status — transport-aware connection status.
router.get('/status', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    if (transport.transportName() === 'meta') {
      const account = await WhatsAppAccount.findOne({ businessId });
      const connected = !!(account && account.phoneNumberId && account.status === 'connected');
      return res.json({
        success: true,
        transport: 'meta',
        connected,
        status: account ? account.status : 'disconnected',
        businessId,
        phoneNumberId: account ? account.phoneNumberId : null,
        displayPhoneNumber: account ? account.displayPhoneNumber : '',
        botPaused: await isBotPaused(businessId),
      });
    }

    const sock = transport.getSock(businessId);
    const status = transport.getStatus(businessId);
    const user = await User.findOne({ businessId });
    res.json({
      success: true,
      transport: 'baileys',
      connected: !!sock && status === 'connected',
      status,
      businessId,
      botPaused: await isBotPaused(businessId),
      userStatus: user ? user.whatsappConnected : false,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/whatsapp/connect — Baileys QR pairing (disabled on Meta).
router.post('/connect', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);

    if (transport.transportName() === 'meta') {
      return res.status(400).json({
        success: false,
        error: 'This deployment uses the official Meta Cloud API. Configure credentials via POST /api/whatsapp/meta/credentials.',
      });
    }

    const existing = transport.getSock(businessId);
    const status = transport.getStatus(businessId);

    if (existing && status === 'connected') {
      return res.json({ success: true, connected: true, message: 'Already connected' });
    }
    if (status === 'logged_out') transport.clearSession(businessId);
    if (status === 'awaiting_scan' || status === 'connecting') {
      const qr = transport.getQR(businessId);
      return res.json({
        success: true,
        connected: false,
        status,
        qr: qr || null,
        qrImage: await qrToDataUrl(qr),
        message: 'Connection in progress. Scan the QR code.',
      });
    }

    const qrPromise = new Promise((resolve) => {
      transport.connectWhatsApp(businessId, (qr) => resolve(qr)).catch((err) => {
        console.error(`Failed to connect ${businessId}:`, err.message);
        resolve(null);
      });
    });
    const qr = await Promise.race([
      qrPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 20000)),
    ]);
    const finalQr = qr || transport.getQR(businessId);
    res.json({
      success: true,
      connected: false,
      status: 'awaiting_scan',
      qr: finalQr,
      qrImage: await qrToDataUrl(finalQr),
      message: finalQr ? 'QR code generated. Scan with WhatsApp > Linked Devices.' : 'QR code generation timed out. Please try again.',
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/whatsapp/qr — poll for QR code (Baileys only).
router.get('/qr', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    if (transport.transportName() === 'meta') {
      const account = await WhatsAppAccount.findOne({ businessId });
      return res.json({
        success: true,
        transport: 'meta',
        businessId,
        connected: !!(account && account.status === 'connected'),
        status: account ? account.status : 'disconnected',
        qr: null,
        qrImage: null,
      });
    }
    const sock = transport.getSock(businessId);
    const status = transport.getStatus(businessId);
    const qr = transport.getQR(businessId);
    res.json({
      success: true,
      businessId,
      connected: !!sock && status === 'connected',
      status,
      qr: qr || null,
      qrImage: await qrToDataUrl(qr),
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    await transport.disconnectWhatsApp(businessId);
    if (transport.transportName() === 'meta') {
      await WhatsAppAccount.updateOne({ businessId }, { status: 'disconnected' });
    }
    await User.findOneAndUpdate({ businessId }, { whatsappConnected: false });
    res.json({ success: true, message: 'WhatsApp disconnected' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/whatsapp/meta/credentials — masked Meta configuration for this tenant.
router.get('/meta/credentials', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    const account = await WhatsAppAccount.findOne({ businessId });
    res.json({
      success: true,
      account: account
        ? {
            provider: account.provider,
            phoneNumberId: account.phoneNumberId || '',
            wabaId: account.wabaId || '',
            displayPhoneNumber: account.displayPhoneNumber || '',
            status: account.status,
            qualityRating: account.qualityRating || '',
            hasToken: !!account.accessTokenEnc,
          }
        : null,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/whatsapp/meta/credentials — save Meta credentials (encrypted at rest).
router.post('/meta/credentials', validate(schemas.metaCredentialsSchema), async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    if (transport.transportName() !== 'meta') {
      return res.status(400).json({ success: false, error: 'Meta transport is not enabled on this server' });
    }
    if (!process.env.ENCRYPTION_KEY) {
      return res.status(500).json({ success: false, error: 'ENCRYPTION_KEY is not configured on the server' });
    }

    const { phoneNumberId, wabaId, accessToken, displayPhoneNumber, verifyToken } = req.body;

    const clash = await WhatsAppAccount.findOne({ phoneNumberId, businessId: { $ne: businessId } });
    if (clash) {
      return res.status(409).json({ success: false, error: 'This phone_number_id is already linked to another business' });
    }

    const account = await WhatsAppAccount.findOneAndUpdate(
      { businessId },
      {
        $set: {
          provider: 'meta',
          phoneNumberId,
          wabaId: wabaId || '',
          displayPhoneNumber: displayPhoneNumber || '',
          // Encrypted at rest; the legacy plaintext column is cleared.
          verifyTokenEnc: verifyToken ? encrypt(verifyToken) : '',
          verifyToken: '',
          accessTokenEnc: encrypt(accessToken),
          status: 'connected',
          lastError: '',
        },
        $setOnInsert: { businessId },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    transport.setMetaStatus(businessId, 'connected');
    await User.findOneAndUpdate({ businessId }, { whatsappConnected: true });

    res.json({
      success: true,
      message: 'Meta credentials saved',
      account: { phoneNumberId: account.phoneNumberId, status: account.status },
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/whatsapp/pause — pause the auto-reply bot (stays connected)
router.post('/pause', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    await pauseBot(businessId);
    res.json({ success: true, paused: true, businessId, botPaused: true });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/whatsapp/resume — resume the auto-reply bot
router.post('/resume', async (req, res) => {
  try {
    const businessId = resolveBusinessId(req);
    await resumeBot(businessId);
    res.json({ success: true, paused: false, businessId, botPaused: false });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
