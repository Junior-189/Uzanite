// Reporting via MongoDB aggregation pipelines (Phase 4).
// Replaces loading whole collections into Node memory for the heavy KPIs.
const Order = require('../models/Order');
const Expense = require('../models/Expense');

function rangeFor(period, now = new Date()) {
  switch (period) {
    case 'daily':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case 'weekly':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'annually':
      return new Date(now.getFullYear(), 0, 1);
    case 'all':
      return new Date(now.getFullYear() - 10, 0, 1);
    default:
      return null;
  }
}

function orderMatch(businessId, start) {
  const match = { businessId, deletedAt: null };
  if (start) match.createdAt = { $gte: start };
  return match;
}

async function statusSummary(businessId, start) {
  return Order.aggregate([
    { $match: orderMatch(businessId, start) },
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } },
  ]).option({ maxTimeMS: 8000, allowDiskUse: true });
}

async function revenueByDay(businessId, start) {
  return Order.aggregate([
    { $match: { ...orderMatch(businessId, start), status: { $in: ['PAID', 'DELIVERED'] } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$total' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]).option({ maxTimeMS: 8000, allowDiskUse: true });
}

async function topProducts(businessId, start, limit = 5) {
  return Order.aggregate([
    { $match: orderMatch(businessId, start) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.productName' },
        quantity: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.subtotal' },
      },
    },
    { $sort: { quantity: -1 } },
    { $limit: limit },
  ]).option({ maxTimeMS: 8000, allowDiskUse: true });
}

async function expensesByCategory(businessId, start) {
  const match = { businessId };
  if (start) match.date = { $gte: start };
  return Expense.aggregate([
    { $match: match },
    { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]).option({ maxTimeMS: 8000, allowDiskUse: true });
}

async function dashboard(businessId, period = 'alltime') {
  const start = rangeFor(period);
  const [statuses, revenueSeries, products, expenses] = await Promise.all([
    statusSummary(businessId, start),
    revenueByDay(businessId, start),
    topProducts(businessId, start),
    expensesByCategory(businessId, start),
  ]);

  const byStatus = {};
  let totalOrders = 0;
  let revenue = 0;
  for (const s of statuses) {
    byStatus[s._id] = s.count;
    totalOrders += s.count;
    if (s._id === 'PAID' || s._id === 'DELIVERED') revenue += s.total;
  }
  const totalExpenses = expenses.reduce((sum, e) => sum + e.total, 0);

  return {
    period,
    rangeStart: start,
    totalOrders,
    byStatus,
    revenue,
    totalExpenses,
    grossProfit: revenue - totalExpenses,
    avgOrderValue: totalOrders ? Math.round(revenue / totalOrders) : 0,
    revenueByDay: revenueSeries.map((r) => ({ date: r._id, revenue: r.revenue, orders: r.orders })),
    topProducts: products.map((p) => ({ productId: p._id, name: p.name, quantity: p.quantity, revenue: p.revenue })),
    expensesByCategory: expenses.map((e) => ({ category: e._id, total: e.total, count: e.count })),
  };
}

module.exports = { dashboard, rangeFor, statusSummary, revenueByDay, topProducts, expensesByCategory };
