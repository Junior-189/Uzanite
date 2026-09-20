const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const Business = require('../models/Business');
const Expense = require('../models/Expense');
const { protect, tenantApproved } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureGuard');
const { sendServerError } = require('../utils/safeError');

// All routes require auth + the tenant's "dashboard" feature flag.
router.use(protect, tenantApproved, requireFeature('dashboard'));

// Helper to get businessId from authenticated user
function getBusinessId(req) {
  return ['super_admin', 'sub_admin'].includes(req.user.role)
    ? (req.query.businessId || 'default')
    : req.user.businessId;
}

// Group key for trend charts based on period
function getGroupKey(date, period) {
  const d = new Date(date);
  switch (period) {
    case 'daily':
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:00`;
    case 'weekly':
    case 'monthly':
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    case 'annually':
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    case 'all':
    case 'alltime':
      return String(d.getFullYear());
    default:
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
}

/**
 * GET /api/dashboard/stats?period=daily|weekly|monthly|annually|all|alltime
 * Returns dashboard statistics filtered by the selected time period.
 */
router.get('/stats', async (req, res) => {
  try {
    const { period = 'alltime' } = req.query;
    const bizId = getBusinessId(req);

    // Determine the date range based on the period
    const now = new Date();
    let startDate = null;

    switch (period) {
      case 'daily': // last 24 hours
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'weekly': // last 7 days
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly': // current month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'annually': // current year
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all': // last 10 years
        startDate = new Date(now.getFullYear() - 10, 0, 1);
        break;
      case 'alltime': // no filter
      default:
        startDate = null;
        break;
    }

    // Build the query filter
    const filter = { businessId: bizId };
    if (startDate) {
      filter.createdAt = { $gte: startDate };
    }

    // Fetch filtered orders
    const orders = await Order.find(filter).sort({ createdAt: -1 });

    // Calculate stats
    const totalOrders = orders.length;
    const pendingOrders = orders.filter((o) => o.status === 'PENDING').length;
    const approvedOrders = orders.filter((o) => o.status === 'APPROVED').length;
    const pendingPaymentOrders = orders.filter((o) => o.status === 'PENDING_PAYMENT').length;
    const paidOrders = orders.filter((o) => o.status === 'PAID' || o.status === 'DELIVERED').length;
    const rejectedOrders = orders.filter((o) => o.status === 'REJECTED').length;
    const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED').length;

    const revenue = orders
      .filter((o) => o.status === 'PAID' || o.status === 'DELIVERED')
      .reduce((sum, o) => sum + (o.total || 0), 0);

    const avgOrderValue = paidOrders > 0 ? Math.round(revenue / paidOrders) : 0;

    // Build product cost map for all ordered products (needed for per-period COGS)
    const allProductIds = [...new Set(orders.flatMap(o => (o.items || []).map(i => i.productId).filter(Boolean)))];
    const costMap = {};
    if (allProductIds.length > 0) {
      const allProducts = await Product.find({ _id: { $in: allProductIds } }).select('_id cost').lean();
      allProducts.forEach(p => { costMap[p._id.toString()] = p.cost || 0; });
    }

    // Trend data grouped by period (hour/day/month/year)
    const revenueTrend = {};
    const ordersTrend = {};
    const cogsTrend = {};
    orders.forEach((order) => {
      const key = getGroupKey(order.createdAt, period);
      ordersTrend[key] = (ordersTrend[key] || 0) + 1;
      if (order.status === 'PAID' || order.status === 'DELIVERED') {
        revenueTrend[key] = (revenueTrend[key] || 0) + (order.total || 0);
        (order.items || []).forEach(item => {
          if (item.productId) {
            cogsTrend[key] = (cogsTrend[key] || 0) + (item.quantity || 1) * (costMap[item.productId.toString()] || 0);
          }
        });
      }
    });

    // Top products (aggregate from order items)
    const productCounts = {};
    orders.forEach(o => (o.items || []).forEach(item => {
      const key = item.productId ? item.productId.toString() : item.productName;
      if (!productCounts[key]) productCounts[key] = { name: item.productName, count: 0, revenue: 0 };
      productCounts[key].count += item.quantity || 1;
      productCounts[key].revenue += item.subtotal || 0;
    }));
    const topProducts = Object.values(productCounts).sort((a, b) => b.count - a.count).slice(0, 5);

    // Cash vs online (only realized revenue: PAID/DELIVERED)
    const cashOrdersArr = orders.filter(o => o.paymentMethod === 'Cash' && (o.status === 'PAID' || o.status === 'DELIVERED'));
    const cashOrders = cashOrdersArr.length;
    const cashRevenue = cashOrdersArr.reduce((sum, o) => sum + (o.total || 0), 0);
    const onlineOrdersArr = orders.filter(o => o.paymentMethod !== 'Cash' && (o.status === 'PAID' || o.status === 'DELIVERED'));
    const onlineOrders = onlineOrdersArr.length;
    const onlineRevenue = onlineOrdersArr.reduce((sum, o) => sum + (o.total || 0), 0);
    const completionRate = totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0;

    // Status breakdown
    const statusBreakdown = {};
    orders.forEach((order) => {
      statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
    });

    // Products count
    const totalProducts = await Product.countDocuments({ businessId: bizId, active: { $ne: false } });

    // Expenses + Profit
    const expenseFilter = { businessId: bizId };
    if (startDate) expenseFilter.date = { $gte: startDate };
    const expenses = await Expense.find(expenseFilter).lean();
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

    // Expenses grouped by period
    const expensesTrend = {};
    expenses.forEach(expense => {
      const key = getGroupKey(expense.date || expense.createdAt, period);
      expensesTrend[key] = (expensesTrend[key] || 0) + (expense.amount || 0);
    });

    // Profit by period = revenue - cogs - expenses
    const profitTrend = {};
    const allTrendKeys = new Set([...Object.keys(revenueTrend), ...Object.keys(cogsTrend), ...Object.keys(expensesTrend)]);
    allTrendKeys.forEach(key => {
      profitTrend[key] = (revenueTrend[key] || 0) - (cogsTrend[key] || 0) - (expensesTrend[key] || 0);
    });

    // Cost of goods sold + overall profit
    const paidOrdersArr = orders.filter((o) => o.status === 'PAID' || o.status === 'DELIVERED');
    let costOfGoodsSold = 0;
    paidOrdersArr.forEach(o => (o.items || []).forEach(item => {
      if (item.productId) costOfGoodsSold += (item.quantity || 1) * (costMap[item.productId.toString()] || 0);
    }));
    const totalProfit = revenue - costOfGoodsSold - totalExpenses;

    // Low stock products
    const lowStockProducts = await Product.find({
      businessId: bizId,
      active: true,
    }).sort({ stock: 1 });
    const lowStockList = lowStockProducts
      .filter(p => p.stock <= p.lowStockThreshold)
      .slice(0, 10)
      .map(p => ({
        _id: p._id,
        name: p.name,
        stock: p.stock,
        threshold: p.lowStockThreshold,
        lastRestockedAt: p.lastRestockedAt,
      }));
    const lowStockCount = lowStockList.length;

    // Businesses count
    const totalBusinesses = await Business.countDocuments();

    // Recent orders (top 10)
    const recentOrders = orders.slice(0, 10).map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      items: o.items,
      total: o.total,
      currency: o.currency,
      status: o.status,
      createdAt: o.createdAt,
    }));

    // Period label for display
    const periodLabels = {
      daily: 'Today (24h)',
      weekly: 'Weekly (7d)',
      monthly: 'Daily (30d)',
      annually: 'Monthly (12m)',
      all: 'Yearly (10y)',
      alltime: 'All Time',
    };

    res.json({
      success: true,
      period,
      periodLabel: periodLabels[period] || 'All Time',
      stats: {
        totalOrders,
        pendingOrders,
        approvedOrders,
        pendingPaymentOrders,
        paidOrders,
        rejectedOrders,
        deliveredOrders,
        revenue,
        avgOrderValue,
        totalProducts,
        totalExpenses,
        costOfGoodsSold,
        totalProfit: totalProfit,
        cashOrders,
        cashRevenue,
        onlineOrders,
        onlineRevenue,
        completionRate,
        lowStockCount: lowStockCount,
        totalBusinesses,
      },
      revenueByDay: revenueTrend,
      ordersByDay: ordersTrend,
      expensesByDay: expensesTrend,
      profitByDay: profitTrend,
      topProducts,
      statusBreakdown,
      lowStockProducts: lowStockList,
      lowStockCount,
      recentOrders,
    });
  } catch (err) {
    sendServerError(res, err, req);
  }
});

module.exports = router;