const express = require('express');
const router = express.Router();
const { uploadMemory, uploadCsv } = require('../middleware/upload');
const Product = require('../models/Product');
const { getAllProducts, getProductById, createProduct, updateProduct, deleteProduct, notifyBackInStockOnCreate, bulkCreateProducts, getLowStockProducts, restockProduct } = require('../services/productService');
const { getAllContacts, getContactCount, broadcastNewProduct } = require('../services/contactService');
const { getSock } = require('../whatsapp/transport');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { enforceLimit } = require('../middleware/planGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "products" feature flag.
router.use(protect, tenantApproved, requireFeature('products'));

// Helper to get businessId from authenticated user
function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/products/contacts — list all chat contacts
router.get('/contacts', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const contacts = await getAllContacts(businessId);
    const count = await getContactCount(businessId);
    res.json({ success: true, count, contacts });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/products — list all products
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { limit, cursor, hasLimit } = parsePagination(req.query);
    if (hasLimit || cursor) {
      const { items, nextCursor } = await paginate(
        Product,
        { businessId, active: true, deletedAt: null },
        { limit: limit || 100, cursor }
      );
      return res.json({ success: true, count: items.length, products: items, nextCursor });
    }
    const products = await getAllProducts(businessId);
    res.json({ success: true, count: products.length, products, nextCursor: null });
  } catch (err) {
    console.error('GET /api/products failed:', err);
    sendServerError(res, err, req);
  }
});

// GET /api/products/barcode/:code — lookup product by barcode
router.get('/barcode/:code', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const product = await Product.findOne({ barcode: req.params.code, businessId, deletedAt: null });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found for this barcode' });
    res.json({ success: true, product });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/products/low-stock — products at or below low stock threshold.
// NOTE: must be declared before '/:id' or Express treats "low-stock" as an id.
router.get('/low-stock', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const products = await getLowStockProducts(businessId);
    res.json({ success: true, count: products.length, products });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/products/:id — get one product
router.get('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    // Ensure product belongs to this tenant
    if (product.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    res.json({ success: true, product });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/products — create product (with optional image)
router.post('/', uploadMemory.single('image'), enforceLimit('products'), validate(schemas.productCreateSchema), async (req, res) => {
  try {
    const { name, description, price, currency, stock, barcode } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, error: 'name and price are required' });

    const businessId = getBusinessId(req);
    let imagePath = null;
    if (req.file) {
      try {
        const { uploadImage } = require('../services/cloudinaryService');
        imagePath = await uploadImage(req.file.buffer);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Image upload failed: ${e.message}` });
      }
    }
    const recordedBy = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const product = await createProduct({
      name,
      description,
      price: Number(price),
      currency: currency || 'TZS',
      stock: stock !== undefined ? Number(stock) : 0,
      businessId,
      imagePath,
      barcode: barcode || null,
      recordedBy,
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      expiryWarnDays: req.body.expiryWarnDays !== undefined ? Number(req.body.expiryWarnDays) : 7,
      clientRef: req.body.clientRef,
    });

    // Notify customers waiting for this product (if name matches an existing product they requested)
    notifyBackInStockOnCreate(product).catch(() => {});

    // Broadcast new product to all chat contacts
    const sock = getSock(businessId);
    if (sock) {
      broadcastNewProduct(sock, product).catch((err) => {
        console.error('Broadcast failed:', err.message);
      });
    }

    res.status(201).json({ success: true, product });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/products/:id — update product
router.put('/:id', uploadMemory.single('image'), validate(schemas.productUpdateSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    // Verify ownership first
    const existing = await getProductById(req.params.id);
    if (!existing || existing.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Explicit allow-list (defence-in-depth against mass assignment).
    const updates = {};
    for (const f of ['name', 'description', 'price', 'minPrice', 'cost', 'currency', 'stock', 'barcode', 'expiryDate', 'expiryWarnDays']) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.file) {
      try {
        const { uploadImage } = require('../services/cloudinaryService');
        updates.imagePath = await uploadImage(req.file.buffer);
      } catch (e) {
        return res.status(400).json({ success: false, error: `Image upload failed: ${e.message}` });
      }
    }
    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.stock !== undefined) updates.stock = Number(updates.stock);
    if (updates.expiryDate !== undefined) updates.expiryDate = updates.expiryDate ? new Date(updates.expiryDate) : null;
    if (updates.expiryWarnDays !== undefined) updates.expiryWarnDays = Number(updates.expiryWarnDays);
    const product = await updateProduct(req.params.id, updates);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, product });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/products/:id — soft delete
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    // Verify ownership first
    const existing = await getProductById(req.params.id);
    if (!existing || existing.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (req.query.permanent === 'true') {
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
      return res.json({ success: true, message: 'Product permanently deleted' });
    }
    const product = await deleteProduct(req.params.id, req.user._id);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, message: 'Product moved to recycle bin' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/products/bulk — bulk import products from CSV
router.post('/bulk', uploadCsv.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'CSV file is required' });
    }
    const businessId = getBusinessId(req);
    const result = await bulkCreateProducts(req.file.path, businessId);
    res.json({ success: true, ...result });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/products/:id/restock — increase stock and update restocked timestamp
router.post('/:id/restock', validate(schemas.restockSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { quantity, expiryDate } = req.body;
    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({ success: false, error: 'Quantity must be > 0' });
    }
    // Verify ownership
    const existing = await getProductById(req.params.id);
    if (!existing || existing.businessId !== businessId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const product = await restockProduct(req.params.id, Number(quantity));
    // Restock with new stock: set the expiry to the new batch's expiry (if provided),
    // otherwise clear the old expiry since that batch is being replaced.
    const newExpiry = expiryDate ? new Date(expiryDate) : null;
    await updateProduct(req.params.id, { expiryDate: newExpiry });
    const updated = await getProductById(req.params.id);
    res.json({ success: true, product: updated });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/products/:id/restore — restore product from recycle bin
router.put('/:id/restore', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const product = await Product.findOne({ _id: req.params.id, businessId, deletedAt: { $ne: null } });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found in recycle bin' });

    await Product.findByIdAndUpdate(req.params.id, { $unset: { deletedAt: 1, deletedBy: 1 }, active: true });
    res.json({ success: true, message: 'Product restored' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;