// ClickPesa adapter (Tanzania). Enabled only when credentials are configured.
// NOTE: field/endpoint names are configurable and should be confirmed against
// the current ClickPesa API docs before go-live.
const crypto = require('crypto');
const config = require('../config/env');

const cfg = config.clickpesa;

function enabled() {
  return !!(cfg.clientId && cfg.apiKey);
}

function verifySignature(rawBody, headers = {}) {
  if (!cfg.webhookSecret) return false;
  const provided = headers['x-clickpesa-signature'] || headers['x-signature'];
  if (!provided || !rawBody) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseWebhook(body = {}) {
  const d = body.data || body;
  return {
    providerRef: d.orderReference || d.reference || d.transactionId || d.id,
    status: d.status || d.paymentStatus,
    amount: d.amount != null ? Number(d.amount) : undefined,
    currency: d.currency,
    failureReason: d.message || d.failureReason,
    raw: body,
  };
}

async function initiate({ phone, amount, currency, method, reference }) {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/third-parties/payments/initiate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': cfg.clientId,
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      amount: String(amount),
      currency: currency || 'TZS',
      phoneNumber: String(phone || '').replace(/\D/g, ''),
      orderReference: reference,
      paymentMethod: method || 'mobile',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `ClickPesa initiate failed (${res.status})`);
    err.status = res.status;
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
  return {
    providerRef: json.orderReference || json.reference || reference,
    status: 'pending',
    raw: json,
  };
}

module.exports = { name: 'clickpesa', enabled, initiate, verifySignature, parseWebhook };
