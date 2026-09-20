const express = require('express');
const router = express.Router();
const ChatContact = require('../models/ChatContact');
const ChatMessage = require('../models/ChatMessage');
const { sendEmail } = require('../services/emailService');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { escapeHtml } = require('../utils/escapeHtml');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "contacts" feature flag.
router.use(protect, tenantApproved, requireFeature('contacts'));

// GET /api/contacts — list all chat contacts
router.get('/', async (req, res) => {
  try {
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;
    const { limit, cursor, hasLimit } = parsePagination(req.query);
    if (hasLimit || cursor) {
      const { items, nextCursor } = await paginate(
        ChatContact,
        { businessId },
        { limit: limit || 100, cursor, sort: { _id: -1 } }
      );
      return res.json({ success: true, count: items.length, contacts: items, nextCursor });
    }
    const contacts = await ChatContact.find({ businessId }).sort({ lastMessageAt: -1 });
    const count = await ChatContact.countDocuments({ businessId });
    res.json({ success: true, count, contacts, nextCursor: null });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/contacts — manually add a new phone number to contacts
router.post('/', validate(schemas.contactCreateSchema), async (req, res) => {
  try {
    const { phone, name } = req.body;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    // Clean the phone number
    const cleanPhone = phone.replace(/[^\d]/g, '');
    if (cleanPhone.length < 5) {
      return res.status(400).json({ success: false, error: 'Invalid phone number' });
    }

    // Check if contact already exists
    const existing = await ChatContact.findOne({ phone: cleanPhone, businessId });
    if (existing) {
      return res.json({ success: true, contact: existing, message: 'Contact already exists' });
    }

    // Create new contact
    const jid = `${cleanPhone}@s.whatsapp.net`;
    const contact = await ChatContact.create({
      phone: cleanPhone,
      jid,
      name: name || '',
      businessId,
      messageCount: 0,
      lastMessageAt: new Date(),
      lastMessage: '[Manually added]',
    });

    res.status(201).json({ success: true, contact, message: 'Contact added successfully' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/contacts/:phone — soft delete a contact (move to recycle bin)
router.delete('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;
    if (req.query.permanent === 'true') {
      const result = await ChatContact.findOneAndDelete({ phone, businessId });
      if (!result) return res.status(404).json({ success: false, error: 'Contact not found' });
      return res.json({ success: true, message: 'Contact permanently deleted' });
    }
    const result = await ChatContact.findOneAndUpdate(
      { phone, businessId },
      { deletedAt: new Date(), deletedBy: req.user._id },
      { new: true }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }
    res.json({ success: true, message: 'Contact moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/contacts/:phone — update a contact's name and/or email
router.put('/:phone', validate(schemas.contactUpdateSchema), async (req, res) => {
  try {
    const { phone } = req.params;
    const { name, email } = req.body;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;

    const contact = await ChatContact.findOne({ phone, businessId });
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });

    if (typeof name === 'string') contact.name = name.trim();
    if (typeof email === 'string') {
      const value = email.trim().toLowerCase();
      if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        return res.status(400).json({ success: false, error: 'Invalid email address' });
      }
      contact.email = value;
    }
    await contact.save();
    res.json({ success: true, contact, message: 'Contact updated' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/contacts/:phone/email — send an email to this specific contact
router.post('/:phone/email', validate(schemas.contactEmailSchema), async (req, res) => {
  try {
    const { phone } = req.params;
    const { subject, message } = req.body;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;

    if (!subject || !subject.trim() || !message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Subject and message are required' });
    }

    const contact = await ChatContact.findOne({ phone, businessId });
    if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
    if (!contact.email) {
      return res.status(400).json({ success: false, error: 'This contact has no email address' });
    }

    const result = await sendEmail({
      to: contact.email,
      subject: subject.trim(),
      html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6;">${escapeHtml(message).replace(/\n/g, '<br/>')}</div>`,
    });

    if (!result.sent) {
      return res.status(502).json({ success: false, error: result.error || 'Email failed to send' });
    }
    res.json({ success: true, message: `Email sent to ${contact.email}`, sentAt: new Date() });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/contacts/:phone/messages — get chat messages for a specific contact
router.get('/:phone/messages', async (req, res) => {
  try {
    const { phone } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before; // cursor-based pagination
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;

    // Verify the contact belongs to this tenant
    const contact = await ChatContact.findOne({ phone, businessId });
    if (!contact) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const query = { contactPhone: phone, businessId };
    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, count: messages.length, messages: messages.reverse() });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/contacts/:phone/restore — restore contact from recycle bin
router.put('/:phone/restore', async (req, res) => {
  try {
    const { phone } = req.params;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;
    const result = await ChatContact.findOneAndUpdate(
      { phone, businessId, deletedAt: { $ne: null } },
      { $unset: { deletedAt: 1, deletedBy: 1 } },
      { new: true }
    );
    if (!result) {
      return res.status(404).json({ success: false, error: 'Contact not found in recycle bin' });
    }
    res.json({ success: true, message: 'Contact restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;