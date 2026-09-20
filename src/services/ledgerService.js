// Append-only financial + stock ledger writers.
const LedgerEntry = require('../models/LedgerEntry');
const StockMovement = require('../models/StockMovement');

// Idempotent: (businessId, type, refType, refId) is unique.
async function recordLedger({
  businessId,
  type,
  direction,
  amount = 0,
  currency = 'TZS',
  refType = '',
  refId = '',
  description = '',
  meta = {},
  recordedBy = '',
  session = null,
}) {
  try {
    const [entry] = await LedgerEntry.create(
      [{ businessId, type, direction, amount, currency, refType, refId, description, meta, recordedBy }],
      { session }
    );
    return entry;
  } catch (err) {
    if (err && err.code === 11000) return null; // already recorded
    throw err;
  }
}

// Idempotent when dedupeKey is supplied.
async function recordStockMovement({
  businessId,
  productId = null,
  productName = '',
  quantity,
  balanceAfter = null,
  reason,
  refType = '',
  refId = '',
  dedupeKey = null,
  recordedBy = '',
  session = null,
}) {
  try {
    const [movement] = await StockMovement.create(
      [
        {
          businessId,
          productId,
          productName,
          quantity,
          balanceAfter,
          reason,
          refType,
          refId,
          dedupeKey,
          recordedBy,
        },
      ],
      { session }
    );
    return movement;
  } catch (err) {
    if (err && err.code === 11000) return null;
    throw err;
  }
}

async function listLedger(businessId, { limit = 100, skip = 0 } = {}) {
  return LedgerEntry.find({ businessId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

async function listStockMovements(businessId, { productId, limit = 100, skip = 0 } = {}) {
  const filter = { businessId };
  if (productId) filter.productId = productId;
  return StockMovement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

async function summarize(businessId) {
  const [rows] = await LedgerEntry.aggregate([
    { $match: { businessId } },
    {
      $group: {
        _id: { type: '$type', direction: '$direction' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]);
  const out = { credit: 0, debit: 0, byType: {} };
  for (const r of rows || []) {
    out.byType[r._id.type] = (out.byType[r._id.type] || 0) + r.total;
    out[r._id.direction] = (out[r._id.direction] || 0) + r.total;
  }
  return out;
}

module.exports = { recordLedger, recordStockMovement, listLedger, listStockMovements, summarize };
