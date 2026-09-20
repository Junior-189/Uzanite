const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const { createNotification } = require('./notificationStore');

// Detect expiry state for a given date + warning window (days).
// Returns 'expired' | 'near' | null
function expiryState(date, warnDays = 7, now = new Date()) {
  if (!date) return null;
  const d = new Date(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 86400000;
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / dayMs);
  if (diff < 0) return 'expired';
  if (diff <= warnDays) return 'near';
  return null;
}

function fmt(date) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Run a one-pass scan: notify for products and purchase batches whose
// expiry is now expired or within the warning window. Each item is
// notified at most once per state (expired vs near) to avoid spam.
const checkExpiries = async () => {
  try {
    const now = new Date();

    // ── Products ──
    const products = await Product.find({ active: { $ne: false }, deletedAt: null, expiryDate: { $ne: null } }).lean();
    for (const p of products) {
      const state = expiryState(p.expiryDate, p.expiryWarnDays ?? 7, now);
      if (!state) continue;
      if (p.expiryNotified === state) continue; // already notified this state

      const when = fmt(p.expiryDate);
      if (state === 'expired') {
        await createNotification({
          businessId: p.businessId,
          type: 'product_expired',
          title: 'Product Expired',
          message: `${p.name} expired on ${when}.`,
          data: { productId: p._id.toString() },
          priority: 'high',
        });
      } else {
        const days = Math.round((new Date(new Date(p.expiryDate).getFullYear(), new Date(p.expiryDate).getMonth(), new Date(p.expiryDate).getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
        await createNotification({
          businessId: p.businessId,
          type: 'product_expiring',
          title: 'Product Expiring Soon',
          message: `${p.name} expires on ${when} (${days} day${days === 1 ? '' : 's'} left).`,
          data: { productId: p._id.toString() },
          priority: 'normal',
        });
      }
      await Product.updateOne({ _id: p._id }, { $set: { expiryNotified: state } });
    }

    // ── Purchase batches ──
    const purchases = await Purchase.find({ deletedAt: null, expiryDate: { $ne: null } }).lean();
    for (const pu of purchases) {
      const state = expiryState(pu.expiryDate, 7, now);
      if (!state) continue;
      if (pu.expiryNotified === state) continue;

      const when = fmt(pu.expiryDate);
      const name = pu.productName || 'Purchase';
      if (state === 'expired') {
        await createNotification({
          businessId: pu.businessId,
          type: 'purchase_expired',
          title: 'Batch Expired',
          message: `${name} batch expired on ${when}.`,
          data: {},
          priority: 'high',
        });
      } else {
        const days = Math.round((new Date(new Date(pu.expiryDate).getFullYear(), new Date(pu.expiryDate).getMonth(), new Date(pu.expiryDate).getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
        await createNotification({
          businessId: pu.businessId,
          type: 'purchase_expiring',
          title: 'Batch Expiring Soon',
          message: `${name} batch expires on ${when} (${days} day${days === 1 ? '' : 's'} left).`,
          data: {},
          priority: 'normal',
        });
      }
      await Purchase.updateOne({ _id: pu._id }, { $set: { expiryNotified: state } });
    }
  } catch (err) {
    console.error('⚠️  Expiry check failed:', err.message);
  }
};

module.exports = { checkExpiries, expiryState };
