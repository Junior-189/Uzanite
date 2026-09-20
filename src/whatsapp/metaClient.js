// Meta WhatsApp Cloud API client (Phase 2 primary transport).
const WhatsAppAccount = require('../models/WhatsAppAccount');
const { decrypt } = require('../utils/crypto');
const config = require('../config/env');
const logger = require('../config/logger');

const GRAPH = `https://graph.facebook.com/${config.metaGraphVersion}`;

function normalizeTo(to) {
  if (!to) return '';
  return String(to).replace(/@s\.whatsapp\.net$/i, '').replace(/@lid$/i, '').replace(/\D/g, '');
}

async function getAccount(businessId) {
  const account = await WhatsAppAccount.findOne({ businessId });
  if (!account) return null;
  const token = account.accessTokenEnc ? decrypt(account.accessTokenEnc) : '';
  return { account, token };
}

async function postMessage(account, token, body) {
  if (!account.phoneNumberId) throw new Error('WhatsApp account has no phoneNumberId');
  if (!token) throw new Error('WhatsApp account has no access token');

  const res = await fetch(`${GRAPH}/${account.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message || `Meta send failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.meta = json?.error;
    // 4xx (except 429) are permanent — do not retry.
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
  return json;
}

async function sendText(businessId, to, text) {
  const found = await getAccount(businessId);
  if (!found) throw new Error(`No WhatsApp account configured for ${businessId}`);
  return postMessage(found.account, found.token, {
    to: normalizeTo(to),
    type: 'text',
    text: { preview_url: false, body: String(text).slice(0, 4096) },
  });
}

async function sendTemplate(businessId, to, { name, language = 'en_US', components = [] }) {
  const found = await getAccount(businessId);
  if (!found) throw new Error(`No WhatsApp account configured for ${businessId}`);
  if (!name) throw new Error('Template name is required');
  return postMessage(found.account, found.token, {
    to: normalizeTo(to),
    type: 'template',
    template: { name, language: { code: language }, components },
  });
}

async function sendMedia(businessId, to, { type = 'image', link, id, caption = '', filename = '' }) {
  const found = await getAccount(businessId);
  if (!found) throw new Error(`No WhatsApp account configured for ${businessId}`);
  if (!link && !id) throw new Error('Media link or id is required');

  const media = {};
  if (id) media.id = id;
  if (link) media.link = link;
  if (caption && (type === 'image' || type === 'document')) media.caption = caption;
  if (filename && type === 'document') media.filename = filename;

  return postMessage(found.account, found.token, {
    to: normalizeTo(to),
    type,
    [type]: media,
  });
}

// Uploads a media buffer to Meta and returns its media id.
async function uploadMedia(businessId, buffer, mimeType, filename = 'file') {
  const found = await getAccount(businessId);
  if (!found) throw new Error(`No WhatsApp account configured for ${businessId}`);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const res = await fetch(`${GRAPH}/${found.account.phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${found.token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) {
    const err = new Error(json?.error?.message || `Meta media upload failed (${res.status})`);
    err.status = res.status;
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
  return json.id;
}

async function sendImageBuffer(businessId, to, buffer, caption = '') {
  const id = await uploadMedia(businessId, buffer, 'image/png', 'image.png');
  return sendMedia(businessId, to, { type: 'image', id, caption });
}

async function sendDocumentBuffer(businessId, to, buffer, filename = 'document.pdf', caption = '') {
  const id = await uploadMedia(businessId, buffer, 'application/pdf', filename);
  return sendMedia(businessId, to, { type: 'document', id, caption, filename });
}

async function markRead(businessId, messageId) {
  try {
    const found = await getAccount(businessId);
    if (!found) return;
    await postMessage(found.account, found.token, {
      status: 'read',
      message_id: messageId,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'markRead failed');
  }
}

module.exports = {
  GRAPH,
  normalizeTo,
  getAccount,
  sendText,
  sendTemplate,
  sendMedia,
  uploadMedia,
  sendImageBuffer,
  sendDocumentBuffer,
  markRead,
};
