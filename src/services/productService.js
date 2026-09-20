const Product = require('../models/Product');
const StockNotification = require('../models/StockNotification');
const { notifyCustomerBackInStock } = require('./notificationService');
const { createNotification } = require('./notificationStore');
const { recordStockMovement } = require('./ledgerService');
const fs = require('fs');
const csv = require('csv-parser');

const getAllProducts = async (businessId = 'default') => {
  return Product.find({ businessId, active: true, deletedAt: null }).sort({ createdAt: -1 });
};

const getProductById = async (id) => {
  return Product.findOne({ _id: id, deletedAt: null });
};

const createProduct = async (data) => {
  // Idempotency: if the client already created this product (e.g. retried after a
  // lost response or offline sync), return the existing one instead of duplicating.
  if (data.clientRef) {
    const existing = await Product.findOne({ clientRef: data.clientRef, businessId: data.businessId, deletedAt: null });
    if (existing) return existing;
  }
  // Guard: never record two products with the same barcode for the same business.
  if (data.barcode) {
    const dup = await Product.findOne({ barcode: data.barcode, businessId: data.businessId, deletedAt: null });
    if (dup) return dup;
  }
  return Product.create(data);
};

const updateProduct = async (id, data) => {
  // Get old product before update to check stock change
  const oldProduct = await Product.findById(id);
  const oldStock = oldProduct ? oldProduct.stock : 0;

  // If stock is being increased, update lastRestockedAt
  if (data.stock !== undefined && oldProduct && data.stock > oldStock) {
    data.lastRestockedAt = new Date();
  }

  const updated = await Product.findByIdAndUpdate(id, data, { new: true });

  // Audit direct stock adjustments.
  if (updated && data.stock !== undefined && updated.stock !== oldStock) {
    await recordStockMovement({
      businessId: updated.businessId,
      productId: updated._id,
      productName: updated.name,
      quantity: updated.stock - oldStock,
      balanceAfter: updated.stock,
      reason: 'manual_adjust',
      refType: 'product',
      refId: String(updated._id),
      recordedBy: 'Owner',
    }).catch(() => {});
  }

  // If stock was decreased, check for low/out of stock alerts
  if (updated && data.stock !== undefined && data.stock < oldStock) {
    const newStock = updated.stock;
    if (newStock === 0) {
      createNotification({ businessId: updated.businessId, type: 'out_of_stock', title: 'Out of Stock', message: `${updated.name} is now out of stock`, data: { productId: updated._id.toString() }, priority: 'critical' });
    } else if (newStock <= updated.lowStockThreshold) {
      createNotification({ businessId: updated.businessId, type: 'low_stock', title: 'Low Stock Alert', message: `${updated.name} has only ${newStock} left (threshold: ${updated.lowStockThreshold})`, data: { productId: updated._id.toString() }, priority: 'high' });
    }
  }

  // If stock was 0 and now has stock again, notify waiting customers
  if (updated && oldStock === 0 && updated.stock > 0) {
    await notifyBackInStock(updated);
  }

  return updated;
};

// Restock product (increase stock and update timestamp)
const restockProduct = async (id, quantity) => {
  const product = await Product.findById(id);
  if (!product) return null;
  const wasOut = product.stock === 0;
  const updated = await Product.findByIdAndUpdate(
    id,
    { $inc: { stock: quantity }, lastRestockedAt: new Date() },
    { new: true }
  );
  if (updated) {
    await recordStockMovement({
      businessId: product.businessId,
      productId: updated._id,
      productName: updated.name,
      quantity,
      balanceAfter: updated.stock,
      reason: 'restock',
      refType: 'product',
      refId: String(updated._id),
      recordedBy: 'Owner',
    }).catch(() => {});
  }
  if (wasOut && updated.stock > 0) {
    createNotification({ businessId: product.businessId, type: 'back_in_stock', title: 'Back in Stock', message: `${product.name} is back in stock (${updated.stock} available)`, data: { productId: product._id.toString() } });
  }
  return updated;
};

// Get low stock products for dashboard alerts
const getLowStockProductsV2 = async (businessId = 'default') => {
  const products = await Product.find({ businessId, active: true, deletedAt: null });
  return products.filter(p => p.stock <= p.lowStockThreshold);
};

const deleteProduct = async (id, userId) => {
  // Soft delete
  return Product.findByIdAndUpdate(id, { active: false, deletedAt: new Date(), deletedBy: userId }, { new: true });
};

const { t } = require('../lang');

const formatProductList = (products, lang = 'en') => {
  if (!products.length) return t('products.list_empty', lang);
  return products
    .map((p, i) => {
      return `*${i + 1}. ${p.name}*\n   💰 ${p.currency} ${p.price.toLocaleString()} ${t('products.remaining', lang, { n: p.stock })}\n   ${p.description || ''}`;
    })
    .join('\n\n');
};

// ── Back-in-Stock Notification ────────────────────────────────────────────────
const notifyBackInStock = async (product) => {
  try {
    // Lazy import to avoid circular dependency
    const { getSock } = require('../whatsapp/transport');
    const sock = getSock(product.businessId);
    if (!sock) return;

    const pendingNotifications = await StockNotification.find({
      productId: product._id,
      notified: false,
    });

    for (const notification of pendingNotifications) {
      await notifyCustomerBackInStock(sock, notification.customerPhone, product.name, null, product.businessId);
      notification.notified = true;
      await notification.save();
    }

    if (pendingNotifications.length > 0) {
      console.log(`✅ Notified ${pendingNotifications.length} customer(s) about "${product.name}" back in stock`);
    }
  } catch (err) {
    console.error('Error sending back-in-stock notifications:', err.message);
  }
};

// ── Also notification on create (for new products, stock > 0) ──────────────────
const notifyBackInStockOnCreate = async (product) => {
  // If creating a product with stock > 0, check if there were existing requests
  if (product.stock > 0) {
    await notifyBackInStock(product);
  }
};

// ── Bulk Import from CSV ──────────────────────────────────────────────────────
const bulkCreateProducts = async (csvFilePath, businessId) => {
  const results = { created: 0, skipped: 0, errors: [] };
  const products = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // Normalize headers: lowercase, trim
        const normalized = {};
        for (const [key, value] of Object.entries(row)) {
          normalized[key.trim().toLowerCase()] = value?.trim();
        }
        products.push(normalized);
      })
      .on('end', async () => {
        try {
          for (const [index, p] of products.entries()) {
            const rowNum = index + 2; // CSV row (1-indexed + header)
            const name = p.name || p.product_name || p['product name'];
            const price = p.price || p.unit_price || p['unit price'];
            const description = p.description || p.desc || '';
            const currency = p.currency || 'TZS';
            const stock = p.stock || p.quantity || p.qty;

            if (!name || price === undefined || price === '') {
              results.errors.push({ row: rowNum, error: 'Missing required fields: name and price' });
              results.skipped++;
              continue;
            }

            const priceNum = Number(price);
            if (isNaN(priceNum) || priceNum < 0) {
              results.errors.push({ row: rowNum, error: 'Invalid price' });
              results.skipped++;
              continue;
            }

            const stockNum = stock === undefined || stock === '' ? 0 : Number(stock);
            if (stock !== undefined && stock !== '' && (isNaN(stockNum) || stockNum < 0)) {
              results.errors.push({ row: rowNum, error: 'Invalid stock (must be >= 0)' });
              results.skipped++;
              continue;
            }

            await Product.create({
              businessId,
              name,
              description,
              price: priceNum,
              currency,
              stock: stockNum,
            });
            results.created++;
          }
          // Clean up temp CSV file
          fs.unlink(csvFilePath, () => {});
          resolve(results);
        } catch (err) {
          fs.unlink(csvFilePath, () => {});
          reject(err);
        }
      })
      .on('error', (err) => {
        fs.unlink(csvFilePath, () => {});
        reject(err);
      });
  });
};

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  formatProductList,
  notifyBackInStockOnCreate,
  bulkCreateProducts,
  restockProduct,
  getLowStockProducts: getLowStockProductsV2,
};
