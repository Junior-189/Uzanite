const express = require('express');
const router = express.Router();
const Debt = require('../models/Debt');
const Business = require('../models/Business');
const ChatContact = require('../models/ChatContact');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const { getSock, sendMessage } = require('../whatsapp/transport');
const { createNotification } = require('../services/notificationStore');
const { t } = require('../lang');
const { parsePagination, paginate } = require('../utils/pagination');
const { sendServerError } = require('../utils/safeError');
const { escapeRegex } = require('../utils/escapeRegex');

router.use(protect, tenantApproved, requireFeature('debts'));

function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// GET /api/debts — list debts
router.get('/', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { status, search } = req.query;
    const filter = { businessId, deletedAt: null };
    if (status && status !== 'all') filter.status = status;
    if (search) {
      // Escape user input — `new RegExp(search)` was a ReDoS/regex-injection vector.
      const r = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ customerName: r }, { customerPhone: r }];
    }
    const { limit, cursor } = parsePagination(req.query);
    const { items, nextCursor } = await paginate(Debt, filter, { limit: limit || 100, cursor });
    const totalUnpaid = items.reduce((s, d) => s + (d.amount - d.paidAmount), 0);
    const totalDebt = items.reduce((s, d) => s + d.amount, 0);
    res.json({ success: true, debts: items, totalUnpaid, totalDebt, count: items.length, nextCursor });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/debts — create debt
router.post('/', validate(schemas.debtCreateSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const { customerName, customerPhone, amount, description, dueDate, orderId, notes } = req.body;
    if (!customerName || !amount) return res.status(400).json({ success: false, error: 'Customer name and amount are required' });
    const recordedBy = req.user.role === 'staff' ? (req.user.name || req.user.email || 'Staff') : 'Owner';
    const debt = await Debt.create({
      businessId,
      customerName: customerName.trim(),
      customerPhone: customerPhone || '',
      amount: Number(amount),
      description: description || '',
      dueDate: dueDate || undefined,
      orderId: orderId || null,
      notes: notes || '',
      recordedBy,
    });
    res.status(201).json({ success: true, debt });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/debts/:id/pay — record payment toward a debt
router.post('/:id/pay', validate(schemas.debtPaySchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const debt = await Debt.findOne({ _id: req.params.id, businessId, deletedAt: null });
    if (!debt) return res.status(404).json({ success: false, error: 'Debt not found' });

    const { paymentAmount } = req.body;
    if (!paymentAmount || paymentAmount <= 0) return res.status(400).json({ success: false, error: 'Valid payment amount required' });

    const newPaid = debt.paidAmount + Number(paymentAmount);
    const remaining = debt.amount - newPaid;

    if (remaining <= 0) {
      debt.paidAmount = debt.amount;
      debt.status = 'paid';
    } else if (newPaid > 0) {
      debt.paidAmount = newPaid;
      debt.status = 'partial';
    }
    if (req.body.notes) debt.notes = (debt.notes + '\n' + req.body.notes).trim();
    await debt.save();

    res.json({ success: true, debt, remaining: Math.max(0, remaining) });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// PUT /api/debts/:id — update debt
router.put('/:id', validate(schemas.debtUpdateSchema), async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    // Explicit allow-list — never `$set: req.body` (audit V10).
    const update = {};
    for (const f of ['customerName', 'customerPhone', 'amount', 'description', 'dueDate', 'notes']) {
      if (req.body[f] !== undefined) update[f] = req.body[f];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }
    const debt = await Debt.findOneAndUpdate(
      { _id: req.params.id, businessId, deletedAt: null },
      update,
      { new: true, runValidators: true }
    );
    if (!debt) return res.status(404).json({ success: false, error: 'Debt not found' });
    res.json({ success: true, debt });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

// POST /api/debts/:id/reminder — send WhatsApp debt reminder
router.post('/:id/reminder', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const debt = await Debt.findOne({ _id: req.params.id, businessId, deletedAt: null });
    if (!debt) return res.status(404).json({ success: false, error: t('debt.not_found', 'sw') });
    if (!debt.customerPhone) return res.status(400).json({ success: false, error: t('debt.reminder_failed_no_phone', 'sw') });

    const business = await Business.findOne({ businessId });
    const businessName = business ? (business.businessName || business.name) : 'Business';

    const lang = 'sw';
    const remaining = debt.amount - debt.paidAmount;
    let clean = (debt.customerPhone || '').replace(/[^0-9]/g, '').replace('@s.whatsapp.net', '').replace('@lid', '');
    if (clean.startsWith('0')) clean = '255' + clean.slice(1);
    const phone = `${clean}@s.whatsapp.net`;

    const fmt = (n) => `TZS ${Number(n).toLocaleString()}`;
    const message = t('debt.reminder_message', lang, {
      businessName,
      customerName: debt.customerName,
      total: fmt(debt.amount),
      paid: fmt(debt.paidAmount),
      remaining: fmt(remaining),
      dueDate: debt.dueDate ? debt.dueDate.toISOString().split('T')[0] : 'N/A'
    }) + '\n\n_Reply STOP to opt out._';

    await sendMessage(phone, message, businessId);
    createNotification({ businessId, type: 'debt_reminder', title: t('debt.reminder_title', lang), message: t('debt.reminder_sent', lang, { customerName: debt.customerName, phone: debt.customerPhone }) });

    res.json({ success: true, message: 'Reminder sent via WhatsApp' });
  } catch (err) {
    console.error('Debt reminder error:', err);
    sendServerError(res, err, req);
  }
});

// POST /api/debts/reminder-all — send reminders to opted-in unpaid/partial debts
router.post('/reminder-all', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const debts = await Debt.find({ businessId, deletedAt: null, status: { $in: ['unpaid', 'partial'] }, customerPhone: { $ne: '' } });

    if (debts.length === 0) return res.status(400).json({ success: false, error: t('debt.no_unpaid_phones', 'sw') });

    // Only message customers who opted in (have a contact and haven't unsubscribed).
    const optedIn = await ChatContact.find({ businessId, deletedAt: null, optIn: true, unsubscribedAt: null }, 'phone').lean();
    const optedInPhones = new Set(optedIn.map((c) => c.phone.replace(/[^0-9]/g, '')));
    const eligible = debts.filter((d) => optedInPhones.has((d.customerPhone || '').replace(/[^0-9]/g, '')));

    if (eligible.length === 0) return res.status(400).json({ success: false, error: 'No opted-in customers with unpaid debts to remind.' });

    const business = await Business.findOne({ businessId });
    const businessName = business ? (business.businessName || business.name) : 'Business';
    const lang = 'sw';
    const fmt = (n) => `TZS ${Number(n).toLocaleString()}`;
    const buildMessage = (debt) => t('debt.reminder_message', lang, {
      businessName,
      customerName: debt.customerName,
      total: fmt(debt.amount),
      paid: fmt(debt.paidAmount),
      remaining: fmt(debt.amount - debt.paidAmount),
      dueDate: debt.dueDate ? debt.dueDate.toISOString().split('T')[0] : 'N/A'
    }) + '\n\n_Reply STOP to opt out._';

    // Acknowledge immediately; send in background (rate-limited queue).
    res.json({ success: true, accepted: true, total: eligible.length, message: `Debt reminders started for ${eligible.length} opted-in customers.` });

    (async () => {
      let sent = 0; let failed = 0;
      for (const debt of eligible) {
        try {
          let clean = (debt.customerPhone || '').replace(/[^0-9]/g, '').replace('@s.whatsapp.net', '').replace('@lid', '');
          if (clean.startsWith('0')) clean = '255' + clean.slice(1);
          await sendMessage(`${clean}@s.whatsapp.net`, buildMessage(debt), businessId);
          sent++;
        } catch (e) {
          failed++;
        }
      }
      createNotification({ businessId, type: 'debt_reminder', title: t('debt.reminder_bulk_title', lang), message: t('debt.reminder_bulk_message', lang, { sent: String(sent), failed: String(failed) }) });
    })().catch((err) => console.error('Bulk reminder error:', err));
  } catch (err) {
    console.error('Bulk reminder error:', err);
    sendServerError(res, err, req);
  }
});

// DELETE /api/debts/:id
router.delete('/:id', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const debt = await Debt.findOneAndUpdate(
      { _id: req.params.id, businessId },
      { deletedAt: new Date(), deletedBy: req.user.email || 'admin' },
      { new: true }
    );
    if (!debt) return res.status(404).json({ success: false, error: 'Debt not found' });
    res.json({ success: true, message: 'Debt deleted' });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;
