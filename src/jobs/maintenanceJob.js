// Scheduled maintenance jobs: expiry + low-stock scans.
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const StoredFile = require('../models/StoredFile');
const { checkExpiries } = require('../services/expiryService');
const { createNotification } = require('../services/notificationStore');
const storage = require('../services/storageService');

async function expiryScanJob() {
  await checkExpiries();
  return { ok: true };
}

async function lowStockScanJob() {
  const products = await Product.find({ active: { $ne: false }, deletedAt: null })
    .select('businessId name stock lowStockThreshold')
    .lean();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let notified = 0;

  for (const p of products) {
    if ((p.stock || 0) > (p.lowStockThreshold || 5)) continue;
    const type = (p.stock || 0) <= 0 ? 'out_of_stock' : 'low_stock';
    // Throttle: at most one such notification per product per 24h.
    const existing = await Notification.findOne({
      businessId: p.businessId,
      type,
      'data.productId': String(p._id),
      createdAt: { $gte: since },
    }).lean();
    if (existing) continue;

    await createNotification({
      businessId: p.businessId,
      type,
      title: type === 'out_of_stock' ? 'Out of Stock' : 'Low Stock Alert',
      message: type === 'out_of_stock' ? `${p.name} is out of stock` : `${p.name} has only ${p.stock} left`,
      data: { productId: String(p._id) },
      priority: type === 'out_of_stock' ? 'critical' : 'high',
    });
    notified++;
  }
  return { notified };
}

// Deletes private objects whose retention window has passed.
async function storageRetentionJob() {
  const expired = await StoredFile.find({ expiresAt: { $ne: null, $lte: new Date() } })
    .limit(500)
    .lean();
  let deleted = 0;
  for (const f of expired) {
    await storage.deleteObject(f.key);
    deleted++;
  }
  return { deleted };
}

module.exports = {
  maintenance: {
    'expiry-scan': expiryScanJob,
    'low-stock-scan': lowStockScanJob,
    'storage-retention': storageRetentionJob,
  },
};
