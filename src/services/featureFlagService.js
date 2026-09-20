// Effective feature flags + server-side enforcement.
const FeatureFlag = require('../models/FeatureFlag');
const User = require('../models/User');

const FEATURE_KEYS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'orders', label: 'Orders' },
  { key: 'products', label: 'Products' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'broadcast', label: 'Email / Broadcast' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'debts', label: 'Debts' },
  { key: 'staff', label: 'Staff' },
  { key: 'reports', label: 'Reports' },
  { key: 'business', label: 'Settings' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'recycleBin', label: 'Recycle Bin' },
];

async function ensureGlobalFlags() {
  for (const { key } of FEATURE_KEYS) {
    await FeatureFlag.findOneAndUpdate(
      { scope: 'global', tenantId: null, key },
      { $setOnInsert: { scope: 'global', tenantId: null, key, enabled: true, message: '' } },
      { upsert: true }
    );
  }
}

// Small in-process TTL cache to avoid a DB read on every guarded request.
// Cross-instance invalidation is broadcast over Redis pub/sub.
const { getRedis } = require('../lib/redis');

const cache = new Map(); // tenantId|'global' -> { value, expires }
const CACHE_TTL_MS = 30 * 1000;
const INVALIDATE_CHANNEL = 'uzanite:flags:invalidate';
let invalidationInitialized = false;

function invalidateFlagsCache() {
  cache.clear();
  const r = getRedis();
  if (r) r.publish(INVALIDATE_CHANNEL, '1').catch(() => {});
}

// Subscribe once so flag changes made on any instance clear every instance.
function initFlagsInvalidation() {
  const r = getRedis();
  if (!r || invalidationInitialized) return;
  invalidationInitialized = true;
  const sub = r.duplicate();
  sub.subscribe(INVALIDATE_CHANNEL).catch(() => {});
  sub.on('message', () => cache.clear());
}

async function getEffectiveFlags(tenantId) {
  const globalFlags = await FeatureFlag.find({ scope: 'global', tenantId: null });
  const overrides = tenantId ? await FeatureFlag.find({ scope: 'tenant', tenantId }) : [];
  return globalFlags.reduce((acc, f) => {
    const ov = overrides.find((o) => o.key === f.key);
    acc[f.key] = { enabled: ov ? ov.enabled : f.enabled, message: ov ? ov.message : f.message };
    return acc;
  }, {});
}

async function getEffectiveFlagsCached(tenantId) {
  const key = tenantId ? String(tenantId) : 'global';
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await getEffectiveFlags(tenantId);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

// Resolve the tenant user id for any authenticated principal (tenant or staff).
async function resolveTenantUserId(user) {
  if (!user) return null;
  if (user.role === 'tenant') return user._id;
  if (user.role === 'staff') {
    const owner = await User.findOne({ businessId: user.businessId }).select('_id').lean();
    return owner ? owner._id : null;
  }
  return null;
}

// Server-side enforcement used by requireFeature().
async function isFeatureEnabled(user, key) {
  if (!user) return true;
  if (user.role === 'super_admin' || user.role === 'sub_admin') return true;
  const tenantId = await resolveTenantUserId(user);
  if (!tenantId) return true;
  const flags = await getEffectiveFlagsCached(tenantId);
  const flag = flags[key];
  return !flag || flag.enabled !== false;
}

module.exports = {
  FEATURE_KEYS,
  ensureGlobalFlags,
  getEffectiveFlags,
  getEffectiveFlagsCached,
  invalidateFlagsCache,
  initFlagsInvalidation,
  isFeatureEnabled,
  resolveTenantUserId,
};
