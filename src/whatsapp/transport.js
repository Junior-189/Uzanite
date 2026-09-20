// WhatsApp transport facade (Phase 2).
//
// Primary transport is the official Meta Cloud API (`WHATSAPP_TRANSPORT=meta`,
// the default). Baileys is legacy and only loaded when explicitly enabled.
// Existing call sites keep using `getSock(businessId).sendMessage(...)`; for
// Meta this returns a facade that enqueues an outbound job.
const config = require('../config/env');
const logger = require('../config/logger');

const TRANSPORT = config.whatsappTransport;

// Lightweight per-process status cache for Meta accounts. The authoritative
// state lives in the WhatsAppAccount document (see routes/whatsapp.js).
const metaStatus = new Map();

function transportName() {
  return TRANSPORT;
}

function setMetaStatus(businessId, status) {
  metaStatus.set(businessId, status);
}

function getStatus(businessId = 'default') {
  if (TRANSPORT === 'baileys') return require('./client').getStatus(businessId);
  return metaStatus.get(businessId) || 'disconnected';
}

async function sendMessage(jid, payload, businessId = 'default') {
  if (TRANSPORT === 'baileys') {
    const client = require('./client');
    if (payload && payload.image) return client.sendImage(jid, payload.image, payload.caption || '', businessId);
    const text = payload && payload.text !== undefined ? payload.text : String(payload);
    return client.sendMessage(jid, text, businessId);
  }

  // Meta: queue the outbound message (retries + rate limiting live in the worker).
  const { enqueue } = require('../queue/queues');
  if (payload && (payload.image || payload.document)) {
    return enqueue('whatsapp-outbound', 'media', { businessId, to: jid, payload });
  }
  const text = payload && payload.text !== undefined ? payload.text : String(payload);
  return enqueue('whatsapp-outbound', 'text', { businessId, to: jid, text });
}

function sendImage(jid, buffer, caption = '', businessId = 'default') {
  return sendMessage(jid, { image: buffer, caption }, businessId);
}

// A socket-like object so legacy `if (sock) sock.sendMessage(...)` guards work.
function getSock(businessId = 'default') {
  if (TRANSPORT === 'baileys') return require('./client').getSock(businessId);
  return {
    sendMessage: (jid, payload) => sendMessage(jid, payload, businessId),
  };
}

function getAllSocks() {
  if (TRANSPORT === 'baileys') return require('./client').getAllSocks();
  return new Map();
}

// ── Baileys-only operations (no-op / disabled on Meta) ──────────────────────
async function connectWhatsApp(businessId, onQR) {
  if (TRANSPORT === 'baileys') return require('./client').connectWhatsApp(businessId, onQR);
  throw new Error('Meta transport does not use QR pairing. Configure Meta credentials instead.');
}
async function disconnectWhatsApp(businessId) {
  if (TRANSPORT === 'baileys') return require('./client').disconnectWhatsApp(businessId);
  setMetaStatus(businessId, 'disconnected');
  return true;
}
function clearSession(businessId) {
  if (TRANSPORT === 'baileys') return require('./client').clearSession(businessId);
  return true;
}
function getQR() {
  return TRANSPORT === 'baileys' ? require('./client').getQR.apply(null, arguments) : null;
}

module.exports = {
  transportName,
  setMetaStatus,
  getStatus,
  sendMessage,
  sendImage,
  getSock,
  getAllSocks,
  connectWhatsApp,
  disconnectWhatsApp,
  clearSession,
  getQR,
};
