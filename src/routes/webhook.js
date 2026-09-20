/**
 * Meta WhatsApp Cloud API Webhook (Phase 2).
 *
 * - Signature verified via X-Hub-Signature-256 (META_APP_SECRET).
 * - Per-tenant routing: phone_number_id -> WhatsAppAccount.businessId.
 * - Inbound messages are deduplicated (WebhookEvent) and dispatched to the
 *   same customer/admin flows as before, scoped to the correct tenant.
 * - Delivery/read/failed statuses update the matching outbound ChatMessage.
 * - Disabled (503) unless Meta credentials are configured.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config/env');
const logger = require('../config/logger');
const WhatsAppAccount = require('../models/WhatsAppAccount');
const WebhookEvent = require('../models/WebhookEvent');
const ChatMessage = require('../models/ChatMessage');
const ChatContact = require('../models/ChatContact');
const User = require('../models/User');
const transport = require('../whatsapp/transport');
const metaClient = require('../whatsapp/metaClient');
const { isBotPaused } = require('../whatsapp/botState');

function verifySignature(req) {
  const secret = config.metaAppSecret;
  if (!secret || !req.rawBody) return false;
  const header = req.headers['x-hub-signature-256'];
  if (!header || typeof header !== 'string') return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function webhookConfigured() {
  return Boolean(config.metaAppSecret && config.metaVerifyToken);
}

function extractText(message) {
  return (
    message.text?.body ||
    message.image?.caption ||
    message.button?.text ||
    message.interactive?.button_reply?.title ||
    message.interactive?.list_reply?.title ||
    ''
  );
}

async function claimEvent(eventId, businessId, type, payload) {
  try {
    await WebhookEvent.create({ eventId, businessId, type, payload });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // duplicate delivery
    throw err;
  }
}

async function recordInbound(businessId, sender, text) {
  const phone = String(sender).replace(/\D/g, '');
  const jid = `${phone}@s.whatsapp.net`;
  await ChatContact.findOneAndUpdate(
    { businessId, phone },
    {
      $set: { lastMessageAt: new Date(), lastMessage: text.slice(0, 200), jid },
      $setOnInsert: { businessId, phone, jid, optIn: true, optInAt: new Date() },
      $inc: { messageCount: 1 },
    },
    { upsert: true }
  );
  await ChatMessage.create({
    businessId,
    contactPhone: phone,
    jid,
    direction: 'inbound',
    text: text.slice(0, 1000),
  });
}

async function handleInbound(businessId, message) {
  const claimed = await claimEvent(`msg:${message.id}`, businessId, 'message', message);
  if (!claimed) return;

  const sender = message.from;
  const text = extractText(message);
  if (!text) return;

  await recordInbound(businessId, sender, text);
  if (await isBotPaused(businessId)) return;

  const metaSock = transport.getSock(businessId);

  // Admin commands may come from the tenant owner or a platform super admin.
  const adminUser = await User.findOne({ businessId, phone: String(sender).replace(/\D/g, '') })
    .select('role')
    .lean();
  const isAdmin = !!(adminUser && ['tenant', 'super_admin'].includes(adminUser.role));

  const { getSession } = require('../services/sessionService');
  const { handleCustomer } = require('../whatsapp/flows/customerFlow');
  const { handleAdmin } = require('../whatsapp/flows/adminFlow');

  if (isAdmin) {
    const handled = await handleAdmin(metaSock, sender, text);
    if (handled !== null) {
      metaClient.markRead(businessId, message.id);
      return;
    }
  }

  const session = await getSession(sender, businessId);
  await handleCustomer(metaSock, sender, text, session);
  metaClient.markRead(businessId, message.id);
}

async function handleStatus(businessId, status) {
  const claimed = await claimEvent(`status:${status.id}:${status.status}`, businessId, 'status', status);
  if (!claimed) return;

  const map = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
  const newStatus = map[status.status] || status.status;
  await ChatMessage.updateOne(
    { businessId, providerMessageId: status.id },
    { $set: { status: newStatus, statusUpdatedAt: new Date() } }
  );
}

async function processPayload(body) {
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      const phoneNumberId = value && value.metadata && value.metadata.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await WhatsAppAccount.findOne({ phoneNumberId });
      if (!account) {
        logger.warn({ phoneNumberId }, 'Inbound webhook for unknown phone_number_id — ignoring');
        continue;
      }
      const businessId = account.businessId;

      await WhatsAppAccount.updateOne(
        { _id: account._id },
        { $set: { lastInboundAt: new Date(), status: 'connected' } }
      ).catch(() => {});
      transport.setMetaStatus(businessId, 'connected');

      for (const message of value.messages || []) {
        await handleInbound(businessId, message);
      }
      for (const status of value.statuses || []) {
        await handleStatus(businessId, status);
      }
    }
  }
}

// Constant-time string comparison for shared secrets, so a token cannot be
// recovered byte-by-byte from response timing.
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    require('crypto').timingSafeEqual(bufA, bufA);
    return false;
  }
  return require('crypto').timingSafeEqual(bufA, bufB);
}

// ── Webhook verification (GET) ────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!webhookConfigured()) return res.sendStatus(503);
  if (mode === 'subscribe' && safeCompare(token, config.metaVerifyToken)) {
    logger.info('Meta webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── Incoming messages (POST) ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!webhookConfigured()) {
    return res.status(503).json({ success: false, error: 'Webhook disabled: Meta credentials not configured' });
  }
  if (!verifySignature(req)) {
    logger.warn('Rejected Meta webhook with invalid/missing signature');
    return res.sendStatus(401);
  }

  // Acknowledge immediately (Meta requires 200 within 20s); process async.
  res.sendStatus(200);
  try {
    await processPayload(req.body);
  } catch (err) {
    logger.error({ err: err.message }, 'Meta webhook processing error');
  }
});

module.exports = router;
