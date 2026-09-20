const { getSession } = require('../services/sessionService');
const { handleCustomer } = require('./flows/customerFlow');
const { handleAdmin } = require('./flows/adminFlow');
const { t } = require('../lang');
const ChatContact = require('../models/ChatContact');
const ChatMessage = require('../models/ChatMessage');
const ConsentLog = require('../models/ConsentLog');
const { createNotification } = require('../services/notificationStore');
const { isBotPaused } = require('./botState');

/**
 * Check if message is opt-out keyword
 */
const isOptOut = (text) => {
  const normalized = text.trim().toUpperCase();
  return ['STOP', 'UNSUBSCRIBE', 'UNSUB', 'OPT OUT', 'REMOVE', 'HAMSI', 'ONDOA'].includes(normalized);
};

/**
 * Check if message is opt-in keyword
 */
const isOptIn = (text) => {
  const normalized = text.trim().toUpperCase();
  return ['START', 'SUBSCRIBE', 'OPT IN', 'ANZA', 'JIONGEZE'].includes(normalized);
};

/**
 * Save or update a chat contact when someone messages the bot.
 * Saves the full JID (e.g. 1234567890@s.whatsapp.net or 1234567890@lid)
 * so we can use it directly for sending messages back.
 */
const saveContact = async (sender, text, businessId = 'default') => {
  try {
    // Skip broadcast/status messages and groups
    if (!sender || sender.includes('@g.us') || sender.includes('status@broadcast')) return;

    // Save the full JID as the phone field (includes @s.whatsapp.net or @lid)
    const jid = sender;
    const phone = jid.replace('@s.whatsapp.net', '').replace('@lid', '');
    if (!phone || phone.length < 5) return;

    const existing = await ChatContact.findOne({ phone, businessId });
    if (existing) {
      // Handle opt-out
      if (isOptOut(text)) {
        existing.unsubscribedAt = new Date();
        existing.optIn = false;
        existing.consentStatus = 'revoked';
        existing.lastMessage = text.substring(0, 200);
        await existing.save();
        ConsentLog.create({ businessId, phone, channel: 'whatsapp', action: 'revoked', source: 'whatsapp_keyword' }).catch(() => {});
        createNotification({ businessId, type: 'contact_opted_out', title: 'Contact Opted Out', message: `${phone} has unsubscribed`, data: { contactPhone: phone }, priority: 'high' });
        return;
      }
      // Handle opt-in
      if (isOptIn(text)) {
        existing.optIn = true;
        existing.optInAt = new Date();
        existing.unsubscribedAt = null;
        existing.consentStatus = 'granted';
        ConsentLog.create({ businessId, phone, channel: 'whatsapp', action: 'granted', source: 'whatsapp_keyword' }).catch(() => {});
      }
      existing.messageCount += 1;
      existing.lastMessageAt = new Date();
      existing.lastMessage = text.substring(0, 200);
      existing.jid = jid; // Update JID in case format changed
      await existing.save();
    } else {
      await ChatContact.create({
        phone,
        jid,
        businessId,
        messageCount: 1,
        lastMessageAt: new Date(),
        lastMessage: text.substring(0, 200),
        optIn: true,
        optInAt: new Date(),
      });
      createNotification({ businessId, type: 'new_contact', title: 'New Contact', message: `New customer: ${phone}`, data: { contactPhone: phone }, priority: 'low' });
    }
  } catch (err) {
    // Don't let contact saving break message handling
    console.error('Error saving chat contact:', err.message);
  }
};

/**
 * Extract plain text from any WhatsApp message type.
 */
const getMessageText = (msg) => {
  const m = msg.message;
  // Prefer buttonId (e.g. "1", "2") so menu switch cases match
  if (m?.buttonsResponseMessage?.selectedButtonId) {
    return m.buttonsResponseMessage.selectedButtonId.trim();
  }
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.buttonsResponseMessage?.selectedDisplayText ||
    m?.listResponseMessage?.title ||
    ''
  ).trim();
};

/**
 * Extract image buffer from message
 */
const getImageBuffer = async (sock, msg) => {
  try {
    const m = msg.message;
    if (!m?.imageMessage) return null;

    // Download image from WhatsApp
    const buffer = await sock.downloadMediaMessage(msg);
    return buffer;
  } catch (err) {
    console.error('Error extracting image:', err.message);
    return null;
  }
};

const getSender = (msg) => msg.key.remoteJid;

const isAdminSender = async (sender) => {
  const User = require('../models/User');
  const cleanSender = sender.replace('@s.whatsapp.net', '').replace('@lid', '');
  const admin = await User.findOne({ phone: cleanSender, role: 'super_admin' }).catch(() => null);
  return !!admin;
};

/**
 * Main message router.
 * 1. If sender is admin → try admin command first, fallback to customer
 * 2. Otherwise → customer flow
 */
const handleMessage = async (sock, msg, businessId = 'default') => {
  const sender = getSender(msg);
  const text = getMessageText(msg);

  if (!text) return;

  console.log(`📩 [${businessId}] ${new Date().toLocaleTimeString()} ${sender}: ${text}`);

  // If the bot is paused for this business, only log the message — do not auto-reply.
  if (await isBotPaused(businessId)) {
    return;
  }

  // Save/update contact for statistics (using the correct businessId)
  saveContact(sender, text, businessId);

  // Save inbound message for chat history (using the correct businessId)
  try {
    const phone = sender.replace('@s.whatsapp.net', '').replace('@lid', '');
    await ChatMessage.create({
      contactPhone: phone,
      jid: sender,
      businessId,
      direction: 'inbound',
      text: text.substring(0, 1000),
    });
  } catch (err) {
    // Don't let message saving break handling
  }

  let lang = 'sw';
  try {
    // Determine language before any handler runs
    try {
      const sess = await getSession(sender, businessId);
      if (sess && sess.language) lang = sess.language;
    } catch {}

    // Admin gets command handling first
    if (await isAdminSender(sender)) {
      let imageBuffer = null;
      if (msg.message?.imageMessage) {
        imageBuffer = await getImageBuffer(sock, msg);
        console.log(`🖼️  Admin sent image with caption: ${text}`);
      }

      const handled = await handleAdmin(sock, sender, text, imageBuffer);
      if (handled !== null) return;
    }

    const session = await getSession(sender, businessId);
    if (session && session.language) lang = session.language;
    await handleCustomer(sock, sender, text, session);
  } catch (err) {
    console.error(`❌ Message handler error for ${sender}:`, err);
    await sock.sendMessage(sender, {
      text: t('error.generic', lang),
    });
  }
};

module.exports = { handleMessage, getMessageText, getSender };
