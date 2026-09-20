const express = require('express');
const router = express.Router();
const ChatContact = require('../models/ChatContact');
const ConsentLog = require('../models/ConsentLog');
const EmailLog = require('../models/EmailLog');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { requireActiveSubscription, enforceLimit } = require('../middleware/planGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const billing = require('../services/billingService');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "broadcast" feature flag.
router.use(protect, tenantApproved, requireFeature('broadcast'));


function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// POST /api/broadcast/send — send a message to opted-in contacts only.
// Body: { message, channel?: 'whatsapp'|'email'|'both' (default 'whatsapp'), subject? }
router.post('/send', requireActiveSubscription, enforceLimit('broadcastsPerMonth'), validate(schemas.broadcastSendSchema), async (req, res) => {
  try {
    const { message, subject } = req.body;
    const channel = (req.body.channel || 'whatsapp').toLowerCase();
    const businessId = getBusinessId(req);

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    if (!['whatsapp', 'email', 'both'].includes(channel)) {
      return res.status(400).json({ success: false, error: "channel must be 'whatsapp', 'email' or 'both'" });
    }

    // Only message contacts who opted in and have not unsubscribed (WhatsApp policy).
    const contacts = await ChatContact.find({
      businessId,
      deletedAt: null,
      optIn: true,
      unsubscribedAt: null,
    }).lean();

    if (contacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No opted-in contacts to broadcast to. Contacts must have messaged you and not replied STOP.',
      });
    }

    const wantWhatsapp = channel === 'whatsapp' || channel === 'both';
    const wantEmail = channel === 'email' || channel === 'both';
    const emailContacts = wantEmail ? contacts.filter((c) => c.email && String(c.email).trim()) : [];

    if (!wantWhatsapp && emailContacts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'None of the opted-in contacts have an email address on file.',
      });
    }

    const total = (wantWhatsapp ? contacts.length : 0) + emailContacts.length;

    // Append an opt-out instruction (required for compliant bulk messaging).

    // Persist a sent log (so the Email page can show a Sent view).
    if (wantEmail) {
      try {
        await EmailLog.create({
          businessId,
          subject: (subject || '').toString().slice(0, 200),
          body: message,
          recipients: emailContacts.map((c) => c.email),
          count: emailContacts.length,
          channel: 'email',
        });
      } catch (e) {
        console.error('Failed to save email log:', e.message);
      }
    }

    res.json({
      success: true,
      accepted: true,
      channel,
      total,
      whatsappCount: wantWhatsapp ? contacts.length : 0,
      emailCount: emailContacts.length,
      message: `Broadcast started via ${channel} to ${total} recipient(s). You'll be notified when it completes.`,
    });

    // Enqueue the fan-out as a background job (per-recipient retries + DLQ).
    const { enqueue } = require('../queue/queues');
    enqueue('broadcast', 'send', {
      businessId,
      channel,
      message,
      subject: subject || '',
      contacts: wantWhatsapp ? contacts.map((c) => ({ jid: c.jid, phone: c.phone })) : [],
      emailContacts: wantEmail ? emailContacts.map((c) => ({ email: c.email })) : [],
    }).catch((err) => console.error('Broadcast enqueue failed:', err.message));

    // Count this broadcast against the plan's monthly quota.
    billing.incrementUsage(businessId, 'broadcastsPerMonth', 1).catch(() => {});

  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/broadcast/sent — list of emails this business has sent (Sent view)
router.get('/sent', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const logs = await EmailLog.find({ businessId }).sort({ sentAt: -1 }).limit(100).lean();
    res.json({ success: true, logs });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/broadcast/contacts — list of contacts that have an email (Contacts panel)
router.get('/contacts', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const contacts = await ChatContact.find({
      businessId,
      deletedAt: null,
      email: { $nin: ['', null] },
    }).sort({ lastMessageAt: -1 }).lean();
    res.json({ success: true, contacts });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/broadcast/contacts — manually add an email contact (add other emails)
router.post('/contacts', validate(schemas.broadcastContactSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }
    const name = String(req.body.name || '').trim();
    // phone is required+unique; use a placeholder derived from the email so it stays unique.
    const phone = `email::${email}`;
    const existing = await ChatContact.findOne({ phone });
    if (existing) {
      return res.status(409).json({ success: false, error: 'This email is already in your contacts' });
    }
    const contact = await ChatContact.create({
      phone,
      email,
      name,
      businessId,
      optIn: true,
      lastMessageAt: new Date(),
    });
    res.status(201).json({ success: true, contact });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/broadcast/contacts/count — get count of contacts available for broadcast
router.get('/contacts/count', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const count = await ChatContact.countDocuments({ businessId });
    res.json({ success: true, count });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/broadcast/import-emails — bulk-import email recipients as contacts.
// Accepts: { data } where `data` is one of:
//   - a JSON array: [{ email, name }, ...]
//   - a CSV string with header `email` (and optional `name`)
// Emails are validated and deduplicated against existing contacts. Imported
// contacts are opted-in so they can receive broadcast emails.
router.post('/import-emails', validate(schemas.broadcastImportSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);

    const raw = req.body && req.body.data;
    if (!raw || !String(raw).trim()) {
      return res.status(400).json({ success: false, error: 'No data provided' });
    }

    // Parse input into an array of { email, name }
    let entries = [];
    const text = String(raw).trim();
    const looksLikeJson = text.startsWith('[') || text.startsWith('{');
    if (looksLikeJson) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid JSON format' });
      }
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      entries = arr
        .map((e) => (e && typeof e === 'object' ? e : { email: e }))
        .map((e) => ({ email: String(e.email || e.Email || e.EMAIL || '').trim(), name: String(e.name || e.Name || e.NAME || '').trim() }));
    } else {
      // CSV: split lines, detect header
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
      const emailIdx = header.indexOf('email');
      const nameIdx = header.indexOf('name');
      const hasHeader = emailIdx !== -1;
      const start = hasHeader ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        const email = (emailIdx !== -1 ? cols[emailIdx] : cols[0]) || '';
        const name = nameIdx !== -1 ? (cols[nameIdx] || '') : (cols[1] || '');
        entries.push({ email: email.trim(), name: name.trim() });
      }
    }

    // Validate emails
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid = entries.filter((e) => EMAIL_RE.test(e.email));
    const invalidCount = entries.length - valid.length;

    if (valid.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid email addresses found' });
    }

    // Deduplicate by email (case-insensitive)
    const seen = new Set();
    const unique = valid.filter((e) => {
      const key = e.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let inserted = 0;
    let updated = 0;
    for (const e of unique) {
      const emailKey = e.email.toLowerCase();
      const existing = await ChatContact.findOne({ $or: [{ email: emailKey }, { phone: `email::${emailKey}` }], businessId });
      if (existing) {
        let changed = false;
        if (!existing.name && e.name) { existing.name = e.name; changed = true; }
        if (!existing.email) { existing.email = emailKey; changed = true; }
        if (changed) { await existing.save(); updated++; }
        continue;
      }
      await ChatContact.create({
        phone: `email::${emailKey}`, // placeholder so unique phone constraint is satisfied
        email: emailKey,
        name: e.name || '',
        businessId,
        // PDPA: imported contacts are NOT opted-in until consent is recorded.
        optIn: false,
        consentStatus: 'pending',
        lastMessageAt: new Date(),
      });
      ConsentLog.create({
        businessId,
        email: emailKey,
        channel: 'email',
        action: 'imported',
        source: 'import',
      }).catch(() => {});
      inserted++;
    }

    const count = await ChatContact.countDocuments({ businessId });
    res.json({
      success: true,
      inserted,
      updated,
      duplicatesSkipped: valid.length - unique.length,
      invalidSkipped: invalidCount,
      total: unique.length,
      contactCount: count,
      message: `Imported ${inserted} new email contact(s), updated ${updated}. ${invalidCount} invalid skipped.`,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
