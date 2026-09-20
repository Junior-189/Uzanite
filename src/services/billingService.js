// SaaS plan entitlements + usage (Phase 4).
const { getPlan } = require('../config/plans');
const UsageCounter = require('../models/UsageCounter');
const User = require('../models/User');
const Product = require('../models/Product');
const Staff = require('../models/Staff');

function periodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isPrivileged(user) {
  return !!(user && (user.role === 'super_admin' || user.role === 'sub_admin'));
}

// Staff inherit the tenant owner's plan.
async function resolveBillingUser(user) {
  if (!user) return null;
  if (user.role === 'staff') {
    return User.findOne({ businessId: user.businessId, role: 'tenant' }).select('-password');
  }
  return user;
}

function statusAllowsSending(user) {
  if (!user || isPrivileged(user)) return true;
  const status = user.subscriptionStatus || 'active';
  if (status === 'active') return true;
  if (status === 'trialing') return !user.trialEndsAt || new Date(user.trialEndsAt) > new Date();
  return false; // past_due | canceled
}

async function currentCount(businessId, metric) {
  if (metric === 'products') return Product.countDocuments({ businessId, deletedAt: null });
  if (metric === 'staff') return Staff.countDocuments({ businessId, status: 'active' });
  const counter = await UsageCounter.findOne({ businessId, metric, periodKey: periodKey() }).lean();
  return counter ? counter.count : 0;
}

async function checkLimit(user, metric) {
  const billingUser = await resolveBillingUser(user);
  if (!billingUser || isPrivileged(billingUser)) return { allowed: true, current: 0, limit: -1 };
  const plan = getPlan(billingUser.plan);
  const limit = plan.limits[metric];
  if (limit === undefined || limit === -1) return { allowed: true, current: 0, limit: -1 };
  const current = await currentCount(billingUser.businessId, metric);
  return { allowed: current < limit, current, limit };
}

async function incrementUsage(businessId, metric, by = 1) {
  if (!businessId) return;
  await UsageCounter.findOneAndUpdate(
    { businessId, metric, periodKey: periodKey() },
    { $inc: { count: by } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function getStatus(user) {
  const billingUser = await resolveBillingUser(user);
  if (!billingUser) return null;
  const plan = getPlan(billingUser.plan);
  const [products, staff, broadcasts, messages] = await Promise.all([
    currentCount(billingUser.businessId, 'products'),
    currentCount(billingUser.businessId, 'staff'),
    currentCount(billingUser.businessId, 'broadcastsPerMonth'),
    currentCount(billingUser.businessId, 'whatsappMessagesPerMonth'),
  ]);
  return {
    plan: plan.key,
    planName: plan.name,
    priceTZS: plan.priceTZS,
    subscriptionStatus: billingUser.subscriptionStatus || 'active',
    trialEndsAt: billingUser.trialEndsAt || null,
    currentPeriodEnd: billingUser.currentPeriodEnd || null,
    periodKey: periodKey(),
    limits: plan.limits,
    features: plan.features,
    usage: { products, staff, broadcastsPerMonth: broadcasts, whatsappMessagesPerMonth: messages },
  };
}

module.exports = {
  periodKey,
  isPrivileged,
  resolveBillingUser,
  statusAllowsSending,
  currentCount,
  checkLimit,
  incrementUsage,
  getStatus,
};
