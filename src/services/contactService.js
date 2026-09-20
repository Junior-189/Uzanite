const ChatContact = require('../models/ChatContact');
const { toJid } = require('./notificationService');

/**
 * Get all chat contacts for a business.
 */
const getAllContacts = async (businessId = 'default') => {
  return ChatContact.find({ businessId, deletedAt: null }).sort({ lastMessageAt: -1 });
};

/**
 * Get contact count for a business.
 */
const getContactCount = async (businessId = 'default') => {
  return ChatContact.countDocuments({ businessId, deletedAt: null });
};

/**
 * Broadcast a new product message to all contacts who chatted with the bot.
 */
const broadcastNewProduct = async (sock, product) => {
  try {
    const contacts = await ChatContact.find({
      businessId: product.businessId || 'default',
      deletedAt: null,
    });

    if (contacts.length === 0) {
      console.log('No contacts to broadcast to.');
      return { sent: 0, failed: 0 };
    }

    const stockText = product.stock === -1 ? 'Available' : `Stock: ${product.stock}`;
    const msg =
      `*New Product Available!*\n\n` +
      `*${product.name}*\n` +
      `Price: ${product.currency || 'TZS'} ${product.price.toLocaleString()}\n` +
      `${stockText}\n` +
      (product.description ? `\n${product.description}\n` : '') +
      `\nType *MENU* to browse and order now.` +
      `\n\n_Reply STOP to opt out._`;

    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      try {
        // Use the saved JID directly (handles both @lid and @s.whatsapp.net formats)
        const jid = contact.jid || toJid(contact.phone);
        await sock.sendMessage(jid, { text: msg });
        sent++;
        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to broadcast to ${contact.phone}:`, err.message);
        failed++;
      }
    }

    console.log(`Broadcast complete: ${sent} sent, ${failed} failed out of ${contacts.length} contacts`);
    return { sent, failed, total: contacts.length };
  } catch (err) {
    console.error('Broadcast error:', err.message);
    return { sent: 0, failed: 0, error: err.message };
  }
};

module.exports = {
  getAllContacts,
  getContactCount,
  broadcastNewProduct,
};