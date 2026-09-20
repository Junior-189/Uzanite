// Outbound WhatsApp message jobs (Meta Cloud API primary, Baileys legacy).
const metaClient = require('../whatsapp/metaClient');
const ChatMessage = require('../models/ChatMessage');
const config = require('../config/env');
const billing = require('../services/billingService');
const metrics = require('../lib/metrics');

// Count an outbound message against the tenant's monthly plan quota + metrics.
function countMessage(businessId) {
  billing.incrementUsage(businessId, 'whatsappMessagesPerMonth', 1).catch(() => {});
  metrics.inc('uzanite_whatsapp_messages_sent_total');
}

// Attaches the Meta provider message id (wamid) to the most recent outbound
// ChatMessage so delivery/read webhooks can be correlated.
async function attachProviderId(businessId, to, json) {
  try {
    const id = json && json.messages && json.messages[0] && json.messages[0].id;
    if (!id) return;
    const phone = metaClient.normalizeTo(to);
    await ChatMessage.findOneAndUpdate(
      { businessId, contactPhone: phone, direction: 'outbound', providerMessageId: '' },
      { $set: { providerMessageId: id, status: 'sent', statusUpdatedAt: new Date() } },
      { sort: { createdAt: -1 } }
    );
  } catch {
    /* non-fatal */
  }
}

function toBuffer(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
  return null;
}

function jidFor(to) {
  return String(to).includes('@') ? to : `${metaClient.normalizeTo(to)}@s.whatsapp.net`;
}

async function sendTextJob({ businessId, to, text }) {
  if (config.whatsappTransport === 'baileys') {
    const { sendMessage } = require('../whatsapp/client');
    return sendMessage(jidFor(to), text, businessId);
  }
  const json = await metaClient.sendText(businessId, to, text);
  await attachProviderId(businessId, to, json);
  countMessage(businessId);
  return json;
}

async function sendMediaJob({ businessId, to, payload }) {
  const { caption = '', mimetype, fileName } = payload || {};
  const buffer = toBuffer(payload && (payload.image || payload.document));

  if (config.whatsappTransport === 'baileys') {
    const client = require('../whatsapp/client');
    const jid = jidFor(to);
    if (buffer) {
      if (payload.document) {
        return client.sendMessage(jid, { document: buffer, mimetype, fileName, caption }, businessId);
      }
      return client.sendImage(jid, buffer, caption, businessId);
    }
    return client.sendMessage(jid, caption || '', businessId);
  }

  if (buffer) {
    const json = payload.document
      ? await metaClient.sendDocumentBuffer(businessId, to, buffer, fileName || 'document.pdf', caption)
      : await metaClient.sendImageBuffer(businessId, to, buffer, caption);
    await attachProviderId(businessId, to, json);
    countMessage(businessId);
    return json;
  }

  const link = payload && (payload.image || payload.document);
  if (typeof link === 'string') {
    const json = await metaClient.sendMedia(businessId, to, {
      type: payload.document ? 'document' : 'image',
      link,
      caption,
      filename: fileName,
    });
    await attachProviderId(businessId, to, json);
    countMessage(businessId);
    return json;
  }
  const json = await metaClient.sendText(businessId, to, caption || '');
  await attachProviderId(businessId, to, json);
  countMessage(businessId);
  return json;
}

module.exports = {
  'whatsapp-outbound': {
    text: sendTextJob,
    media: sendMediaJob,
  },
};
