const billing = require('../services/billingService');

// Blocks WhatsApp sending when a tenant's subscription is past due/canceled
// (unless within an active trial). Privileged accounts bypass.
async function requireActiveSubscription(req, res, next) {
  try {
    const user = await billing.resolveBillingUser(req.user);
    if (billing.statusAllowsSending(user || req.user)) return next();
    return res.status(402).json({
      success: false,
      error: 'Your subscription is past due. WhatsApp sending is disabled until you renew.',
    });
  } catch (err) {
    next(err);
  }
}

// Blocks a mutation when a plan limit would be exceeded.
function enforceLimit(metric) {
  return async (req, res, next) => {
    try {
      const result = await billing.checkLimit(req.user, metric);
      if (!result.allowed) {
        return res.status(403).json({
          success: false,
          error: `Plan limit reached for ${metric} (${result.current}/${result.limit}). Upgrade your plan to continue.`,
          limit: { metric, current: result.current, max: result.limit },
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireActiveSubscription, enforceLimit };
