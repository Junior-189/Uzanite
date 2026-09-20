// Payments adapter registry. Providers share the interface:
//   { name, enabled(), initiate(ctx), verifySignature(rawBody, headers), parseWebhook(body) }
const manual = require('./manualProvider');
const clickpesa = require('./clickpesaProvider');
const azampay = require('./azampayProvider');

const providers = { manual, clickpesa, azampay };

function getProvider(name) {
  if (!name) return null;
  return providers[String(name).toLowerCase()] || null;
}

function listProviders() {
  return Object.values(providers).map((p) => ({ name: p.name, enabled: p.enabled() }));
}

module.exports = { getProvider, listProviders, providers };
