const express = require('express');
const router = express.Router();
const ChatContact = require('../models/ChatContact');
const ChatMessage = require('../models/ChatMessage');
const { sendMessage } = require('../whatsapp/transport');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { requireActiveSubscription } = require('../middleware/planGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "whatsapp" feature flag.
router.use(protect, tenantApproved, requireFeature('whatsapp'));

// GET /api/chat/:phone — get chat messages for a contact
router.get('/:phone', async (req, res) => {
  try {
    const { phone } = req.params;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;
    const limit = parseInt(req.query.limit) || 50;

    const messages = await ChatMessage.find({ contactPhone: phone, businessId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/chat/send — send a message to a specific customer
router.post('/send', requireActiveSubscription, validate(schemas.chatSendSchema), async (req, res) => {
  try {
    const { phone, message } = req.body;
    const businessId = ['super_admin', 'sub_admin'].includes(req.user.role)
      ? (req.query.businessId || 'default')
      : req.user.businessId;

    if (!phone || !message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Phone number and message are required' });
    }

    // Find contact to get JID
    let contact = await ChatContact.findOne({ phone, businessId });

    // If contact doesn't exist, create one
    const jid = contact?.jid || `${phone}@s.whatsapp.net`;

    // Send the message via WhatsApp
    await sendMessage(jid, message, businessId);

    // Save outbound message to chat history
    await ChatMessage.create({
      contactPhone: phone,
      jid,
      businessId,
      direction: 'outbound',
      text: message.substring(0, 1000),
    });

    // Update contact stats
    if (contact) {
      contact.lastMessageAt = new Date();
      contact.lastMessage = message.substring(0, 200);
      contact.messageCount = (contact.messageCount || 0) + 1;
      await contact.save();
    }

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
