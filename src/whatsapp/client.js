const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { handleMessage } = require('./messageHandler');
const { createNotification } = require('../services/notificationStore');
const path = require('path');
const fs = require('fs');

// Session storage base — override with SESSION_DIR (e.g. a mounted persistent disk)
// so WhatsApp auth survives server restarts. Defaults to repo-local sessions/ which
// is wiped on platforms with an ephemeral filesystem (e.g. Render free tier).
const SESSION_BASE = process.env.SESSION_DIR || path.join(__dirname, '..', '..', 'sessions');

// Global crash handlers so a single bad message or DB error does not silently
// kill the process (and with it the WhatsApp connection).
let globalHandlersRegistered = false;
function registerGlobalHandlers() {
  if (globalHandlersRegistered) return;
  globalHandlersRegistered = true;
  process.on('uncaughtException', (err) => {
    console.error('💥 uncaughtException:', (err && err.stack) || err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('💥 unhandledRejection:', (reason && reason.stack) || reason);
  });
}

// Store multiple WhatsApp connections keyed by businessId
const connections = new Map();
// Store last QR code per businessId for API access
const qrCodes = new Map();
// Store connection status per businessId
const connectionStatus = new Map();
// Track pending reconnect timers to avoid stacking duplicate sockets
const reconnectTimers = new Map();
// Track in-progress connections to avoid duplicate connects for the same business
const connecting = new Map();
// Sockets we intentionally ended for replacement — their 'close' must NOT reconnect
const replacedSockets = new Set();
// Sockets ended by a manual disconnect — their 'close' must NOT reconnect
const manualDisconnects = new Set();

const getSock = (businessId = 'default') => connections.get(businessId) || null;
const getAllSocks = () => connections;
const getQR = (businessId = 'default') => qrCodes.get(businessId) || null;
const getStatus = (businessId = 'default') => connectionStatus.get(businessId) || 'disconnected';

/**
 * Connect WhatsApp for a specific business/tenant
 * @param {string} businessId - The business ID to connect for
 * @param {Function} onQR - Callback when QR code is generated (receives base64 QR)
 * @returns {Promise<object>} The socket connection
 */
const connectWhatsApp = async (businessId = 'default', onQR = null) => {
  registerGlobalHandlers();

  // Avoid stacking duplicate connection attempts for the same business
  if (connecting.get(businessId)) {
    console.log(`ℹ️  Connect already in progress for ${businessId}, reusing existing.`);
    return connections.get(businessId) || null;
  }
  connecting.set(businessId, true);

  try {
    return await _connectWhatsApp(businessId, onQR);
  } catch (err) {
    console.error(`❌ connectWhatsApp(${businessId}) failed:`, (err && err.stack) || err);
    connecting.delete(businessId);
    connectionStatus.set(businessId, 'disconnected');
    if (onQR) onQR(null);
    throw err;
  }
};

async function _connectWhatsApp(businessId = 'default', onQR = null) {

  const sessionDir = path.join(SESSION_BASE, businessId);

  // If we are (re)starting after a logout/auth-failure, tear down any stale
  // socket completely first to avoid two live sockets conflicting (which causes
  // WhatsApp to reject the new scan with 515 / 428).
  const existing = connections.get(businessId);
  if (existing) {
    try {
      existing.end(new Error('Replacing connection'));
    } catch (e) { /* ignore */ }
    connections.delete(businessId);
  }
  connecting.delete(businessId);
  if (reconnectTimers.has(businessId)) {
    clearTimeout(reconnectTimers.get(businessId));
    reconnectTimers.delete(businessId);
  }

  // Ensure session directory exists
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  // Fetch the latest WhatsApp Web version. If this network call fails (e.g. the
  // server can't reach Baileys' version endpoint), fall back to a known-good
  // version so connection still proceeds instead of failing outright.
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (e) {
    console.error('⚠️ fetchLatestBaileysVersion failed, using fallback:', e.message);
    version = { version: '2.2490.4' };
  }

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: [`UZANITE - ${businessId}`, 'Chrome', '1.0.0'],
  });

  // Cleanly tear down any previous live socket so WhatsApp does not see two
  // simultaneous connections (which triggers a "connection replaced" logout).
  const old = connections.get(businessId);
  if (old && old !== sock) {
    try { old.end(new Error('Replacing connection')); } catch (e) { /* ignore */ }
    connections.delete(businessId);
  }

  // Store connection
  connections.set(businessId, sock);

  connectionStatus.set(businessId, 'connecting');

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log(`\n📱 QR for ${businessId}: Scan in WhatsApp > Linked Devices\n`);
      qrcode.generate(qr, { small: true });
      // Store QR code for API access
      qrCodes.set(businessId, qr);
      connectionStatus.set(businessId, 'awaiting_scan');
      if (onQR) onQR(qr);
    }

    if (connection === 'close') {
      // This socket was intentionally replaced or manually disconnected — do not reconnect it.
      if (replacedSockets.has(sock)) {
        replacedSockets.delete(sock);
        return;
      }
      if (manualDisconnects.has(sock)) {
        manualDisconnects.delete(sock);
        return;
      }
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || (lastDisconnect?.error && lastDisconnect?.error.toString());
      // Codes that indicate stale/invalid auth or a temporary ban. Reconnecting
      // automatically with the SAME (now-bad) credentials just loops: scan →
      // 515/401 → reconnect → scan again. Instead, clear the creds and require
      // a fresh manual scan via the Generate QR button.
      const isAuthFailure = [
        DisconnectReason.loggedOut,   // 428 — credentials revoked
        DisconnectReason.connectionUnsafelyDisconnect, // 401
        DisconnectReason.restartRequired, // 421
      ].includes(code);
      const isBan = code === 515 || code === 440 || code === 405;
      let shouldReconnect = code !== DisconnectReason.loggedOut;
      if (isAuthFailure || isBan) shouldReconnect = false; // force fresh scan
      console.log(`⚠️  ${businessId} disconnected (code ${code}).${reason ? ' Reason: ' + reason : ''} Reconnect: ${shouldReconnect}`);
      connectionStatus.set(businessId, shouldReconnect ? 'disconnected' : 'logged_out');
      qrCodes.delete(businessId);
      reconnectTimers.delete(businessId);
      connecting.delete(businessId);
      createNotification({ businessId, type: 'whatsapp_disconnected', title: 'WhatsApp Disconnected', message: `WhatsApp disconnected for ${businessId}${code ? ' (code: ' + code + ')' : ''}`, data: {}, priority: 'high' });
      if (shouldReconnect) {
        if (reconnectTimers.has(businessId)) return; // avoid stacking duplicate sockets
        // Temporary ban (515): back off longer so we don't worsen the ban
        const delay = code === 515 ? 60000 : 3000;
        if (code === 515) console.log(`⏳ ${businessId} temporary ban — backing off ${delay / 1000}s before retry`);
        const t = setTimeout(() => {
          reconnectTimers.delete(businessId);
          connectWhatsApp(businessId, onQR);
        }, delay);
        reconnectTimers.set(businessId, t);
      } else {
        console.log(`🔴 ${businessId} logged out / auth failure — clearing creds for fresh scan.`);
        connections.delete(businessId);
        connectionStatus.set(businessId, 'logged_out');
        clearSession(businessId);
        // Update User model
        const User = require('../models/User');
        User.findOneAndUpdate(
          { businessId },
          { whatsappConnected: false }
        ).catch(() => {});
      }
    }

    if (connection === 'open') {
      console.log(`✅ WhatsApp connected for ${businessId}!`);
      connectionStatus.set(businessId, 'connected');
      connecting.delete(businessId);
      qrCodes.delete(businessId); // No longer needed
      createNotification({ businessId, type: 'whatsapp_connected', title: 'WhatsApp Connected', message: `WhatsApp connected successfully for ${businessId}`, data: {} });

      // Update User model if this is a tenant
      const User = require('../models/User');
      User.findOneAndUpdate(
        { businessId },
        { whatsappConnected: true }
      ).then(async (user) => {
        if (user && user.role === 'tenant' && user.status === 'pending') {
          // Notify admin about new user WhatsApp scan
          try {
            // Find super admin
            const admin = await User.findOne({ role: 'super_admin' });
            if (!admin) return;

            const { getSock, getStatus, sendMessage } = require('./client');
            const adminSock = getSock('default');

            if (adminSock && getStatus('default') === 'connected') {
              const message = `🔔 *New User Registration - WhatsApp Scanned*\n\n` +
                `*Name:* ${user.name}\n` +
                `*Email:* ${user.email}\n` +
                `*Phone:* ${user.phone || 'N/A'}\n` +
                `*Business:* ${user.businessName}\n` +
                `*Business ID:* ${user.businessId}\n` +
                `*WhatsApp:* Connected ✅\n\n` +
                `Please review and approve/reject this user in the admin panel.\n` +
                `Login at: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/login.html`;

              // Send to admin's WhatsApp if available
              if (admin.phone) {
                await sendMessage(`${admin.phone}@s.whatsapp.net`, message);
              }
              console.log(`📧 Admin notified about new user scan: ${user.email}`);
            }
          } catch (err) {
            console.error('Failed to notify admin:', err.message);
          }
        }
      }).catch(() => {});
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;
      try {
        await handleMessage(sock, msg, businessId);
      } catch (err) {
        console.error(`❌ handleMessage error (${businessId}):`, (err && err.stack) || err);
      }
    }
  });

  return sock;
};

const clearSession = (businessId) => {
  try {
    const sessionDir = path.join(SESSION_BASE, businessId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`🧹 Cleared WhatsApp session for ${businessId}`);
    }
  } catch (err) {
    console.error(`Failed to clear session ${businessId}:`, err.message);
  }
};

const disconnectWhatsApp = async (businessId) => {
  const sock = connections.get(businessId);
  connecting.delete(businessId);
  if (sock) {
    manualDisconnects.add(sock);
    sock.end(new Error('Manual disconnect'));
    connections.delete(businessId);
    connectionStatus.set(businessId, 'disconnected');
    console.log(`🔌 Disconnected WhatsApp for ${businessId}`);
  }
  // Clear stale credentials so a fresh connect generates a clean QR scan
  // instead of reusing a stale/invalid session (which causes silent auth failure).
  clearSession(businessId);
};

const sendMessage = async (jid, text, businessId = 'default') => {
  const sock = connections.get(businessId);
  if (!sock) throw new Error(`WhatsApp not connected for ${businessId}`);
  return enqueueSend(() => sock.sendMessage(jid, { text }));
};

const sendImage = async (jid, buffer, caption = '', businessId = 'default') => {
  const sock = connections.get(businessId);
  if (!sock) throw new Error(`WhatsApp not connected for ${businessId}`);
  return enqueueSend(() => sock.sendMessage(jid, { image: buffer, caption }));
};

// ── Outbound rate limiter ──────────────────────────────────────────────────
// Serializes every outbound message through a single queue with a minimum gap
// plus jitter. Bursting identical messages to many recipients is the #1 cause
// of WhatsApp (anti-spam) bans, so we never send faster than the gap allows.
const SEND_GAP_MS = 1500;
const SEND_JITTER_MS = 1000;
const sendQueue = [];
let draining = false;

function enqueueSend(task) {
  return new Promise((resolve, reject) => {
    sendQueue.push({ task, resolve, reject });
    drainSendQueue();
  });
}

async function drainSendQueue() {
  if (draining) return;
  draining = true;
  while (sendQueue.length) {
    const { task, resolve, reject } = sendQueue.shift();
    try {
      resolve(await task());
    } catch (err) {
      reject(err);
    }
    if (sendQueue.length) {
      await new Promise((r) => setTimeout(r, SEND_GAP_MS + Math.floor(Math.random() * SEND_JITTER_MS)));
    }
  }
  draining = false;
}

module.exports = { connectWhatsApp, disconnectWhatsApp, clearSession, sendMessage, sendImage, getSock, getAllSocks, getQR, getStatus };
