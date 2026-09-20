// AzamPay adapter (Tanzania). Enabled only when credentials are configured.
// NOTE: field/endpoint names are configurable and should be confirmed against
// the current AzamPay API docs before go-live.
const crypto = require('crypto');
const config = require('../config/env');

const cfg = config.azampay;
let cachedToken = null;
let tokenExpiresAt = 0;

function enabled() {
  return !!(cfg.appName && cfg.clientId && cfg.clientSecret);
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/AppRegistration/GenerateToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appName: cfg.appName,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.data?.accessToken) {
    const err = new Error(json.message || `AzamPay auth failed (${res.status})`);
    err.status = res.status;
    err.permanent = res.status >= 400 && res.status < 500;
    throw err;
  }
  cachedToken = json.data.accessToken;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

function verifySignature(rawBody, headers = {}) {
  if (!cfg.webhookSecret) return false;
  const provided = headers['x-azampay-signature'] || headers['x-signature'];
  if (!provided || !rawBody) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseWebhook(body = {}) {
  const d = body.data || body;
  return {
    providerRef: d.externalId || d.reference || d.transactionId || d.id,
    status: d.status || d.transactionStatus,
    amount: d.amount != null ? Number(d.amount) : undefined,
    currency: d.currency,
    failureReason: d.message,
    raw: body,
  };
}

async function initiate({ phone, amount, currency, method, reference }) {
  const token = await getToken();
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/azampay/mno/checkout`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      accountNumber: String(phone || '').replace(/\D/g, ''),
      amount: String(amount),
      currency: currency || 'TZS',
      externalId: reference,
      provider: method || 'Mpesa',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `AzamPay initiate failed (${res.status})`);
    err.status = res.status;
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
  return {
    providerRef: json.transactionId || json.reference || reference,
    status: 'pending',
    raw: json,
  };
}

module.exports = { name: 'azampay', enabled, initiate, verifySignature, parseWebhook };
