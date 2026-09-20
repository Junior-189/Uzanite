// SaaS plan catalog (Phase 4). Limits use -1 for "unlimited".
const PLANS = {
  free: {
    key: 'free',
    name: 'Free',
    priceTZS: 0,
    limits: { products: 50, staff: 2, broadcastsPerMonth: 1, whatsappMessagesPerMonth: 500 },
    features: { broadcast: true, reports: false, payments: false, api: false },
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceTZS: 25000,
    limits: { products: 2000, staff: 10, broadcastsPerMonth: 50, whatsappMessagesPerMonth: 20000 },
    features: { broadcast: true, reports: true, payments: true, api: false },
  },
  business: {
    key: 'business',
    name: 'Business',
    priceTZS: 75000,
    limits: { products: -1, staff: -1, broadcastsPerMonth: -1, whatsappMessagesPerMonth: -1 },
    features: { broadcast: true, reports: true, payments: true, api: true },
  },
};

function getPlan(name) {
  return PLANS[name] || PLANS.free;
}

module.exports = { PLANS, getPlan, PLAN_NAMES: Object.keys(PLANS) };
