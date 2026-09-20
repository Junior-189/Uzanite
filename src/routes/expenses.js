const express = require('express');
const router = express.Router();
const Expense = require('../models/Expense');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');

router.use(protect, tenantApproved, requireFeature('expenses'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/expenses — list expenses
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { period = 'all' } = req.query;
    const now = new Date();
    let startDate = null;
    switch (period) {
      case 'daily': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
      case 'weekly': { const d = now.getDay(); startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1)); break; }
      case 'monthly': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'annually': startDate = new Date(now.getFullYear(), 0, 1); break;
    }
    const filter = { businessId };
    if (startDate) filter.date = { $gte: startDate };
    const { limit, cursor } = parsePagination(req.query);
    const { items, nextCursor } = await paginate(Expense, filter, { limit: limit || 100, cursor });
    const total = items.reduce((s, e) => s + (e.amount || 0), 0);
    res.json({ success: true, expenses: items, total, count: items.length, nextCursor });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/expenses — create expense
router.post('/', validate(schemas.expenseCreateSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { description, amount, category, date } = req.body;
    if (!description || !amount) return res.status(400).json({ success: false, error: 'Description and amount are required' });
    const recordedBy = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const expense = await Expense.create({ businessId, description, amount: Number(amount), category: category || 'Other', recordedBy, date: date || new Date() });
    res.status(201).json({ success: true, expense });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, businessId });
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
