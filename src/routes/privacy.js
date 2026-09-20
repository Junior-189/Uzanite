const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const privacyService = require('../services/privacyService');
const ConsentLog = require('../models/ConsentLog');
const ChatContact = require('../models/ChatContact');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved);

function biz(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/privacy/export — full tenant data export (PDPA data portability).
router.get('/export', async (req, res) => {
  try {
    const businessId = biz(req);
    const data = await privacyService.exportTenant(businessId);
    res.setHeader('Content-Disposition', `attachment; filename="uzanite-export-${businessId}.json"`);
    res.json(data);
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/privacy/erase — erase a data subject (right to be forgotten).
router.post('/erase', validate(schemas.privacyEraseSchema), async (req, res) => {
  try {
    const results = await privacyService.eraseDataSubject(biz(req), req.body);
    res.json({ success: true, results });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/privacy/consent — record marketing consent grant/revoke.
router.post('/consent', validate(schemas.consentSchema), async (req, res) => {
  try {
    const businessId = biz(req);
    const { phone, email, channel, action } = req.body;
    await ConsentLog.create({
      businessId,
      phone: phone ? String(phone).replace(/\D/g, '') : '',
      email: email ? String(email).trim().toLowerCase() : '',
      channel: channel || 'any',
      action,
      source: 'api',
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    const update =
      action === 'granted'
        ? { optIn: true, unsubscribedAt: null, consentStatus: 'granted' }
        : { optIn: false, unsubscribedAt: new Date(), consentStatus: 'revoked' };
    const query = phone
      ? { businessId, phone: String(phone).replace(/\D/g, '') }
      : { businessId, email: String(email).trim().toLowerCase() };
    await ChatContact.updateMany(query, { $set: update });

    res.json({ success: true });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
