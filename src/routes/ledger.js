const express = require('express');
const router = express.Router();
const { protect, tenantApproved } = require('../middleware/auth');
const { listStockMovements, summarize } = require('../services/ledgerService');
const LedgerEntry = require('../models/LedgerEntry');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved);

function biz(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/ledger — financial ledger entries.
router.get('/', async (req, res) => {
  try {
    const businessId = biz(req);
    const { limit, cursor } = parsePagination(req.query);
    const { items, nextCursor } = await paginate(LedgerEntry, { businessId }, { limit: limit || 100, cursor });
    res.json({ success: true, entries: items, nextCursor });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/ledger/summary — totals by type/direction.
router.get('/summary', async (req, res) => {
  try {
    res.json({ success: true, summary: await summarize(biz(req)) });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// GET /api/ledger/stock — stock movement history.
router.get('/stock', async (req, res) => {
  try {
    const movements = await listStockMovements(biz(req), {
      productId: req.query.productId,
      limit: Math.min(Number(req.query.limit) || 100, 500),
      skip: Number(req.query.skip) || 0,
    });
    res.json({ success: true, movements });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
