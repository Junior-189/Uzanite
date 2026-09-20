import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../../src/models/Order.js');
const Expense = require('../../src/models/Expense.js');
const { parsePagination, paginate } = require('../../src/utils/pagination.js');
const analyticsService = require('../../src/services/analyticsService.js');

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('parsePagination', () => {
  it('only paginates when a limit is supplied (backward compatible)', () => {
    expect(parsePagination({}).limit).toBeNull();
    expect(parsePagination({}).hasLimit).toBe(false);
    expect(parsePagination({ limit: '10' }).limit).toBe(10);
  });

  it('caps the page size and validates the cursor', () => {
    expect(parsePagination({ limit: '9999' }).limit).toBe(500);
    expect(parsePagination({ limit: '0' }).limit).toBe(1);
    expect(parsePagination({ cursor: 'not-an-id' }).cursor).toBeNull();
    expect(parsePagination({ cursor: '0123456789abcdef01234567' }).cursor).toBe('0123456789abcdef01234567');
  });
});

describe('cursor pagination + aggregation (DB-backed)', () => {
  beforeAll(async () => {
    const docs = [];
    for (let i = 0; i < 25; i++) {
      docs.push({
        businessId: 'biz_pg',
        orderNumber: `PG-${String(i).padStart(3, '0')}`,
        customerName: 'x',
        items: [],
        total: 100,
        currency: 'TZS',
        status: i % 2 ? 'PAID' : 'PENDING',
      });
    }
    await Order.insertMany(docs);
    await Expense.insertMany([
      { businessId: 'biz_pg', description: 'Rent', amount: 1000, category: 'Rent' },
      { businessId: 'biz_pg', description: 'Power', amount: 200, category: 'Utilities' },
    ]);
  });

  it('paginates without duplicates or gaps', async () => {
    const p1 = await paginate(Order, { businessId: 'biz_pg', deletedAt: null }, { limit: 10 });
    expect(p1.items.length).toBe(10);
    expect(p1.nextCursor).toBeTruthy();

    const p2 = await paginate(Order, { businessId: 'biz_pg', deletedAt: null }, { limit: 10, cursor: p1.nextCursor });
    const ids1 = new Set(p1.items.map((o) => String(o._id)));
    expect(p2.items.every((o) => !ids1.has(String(o._id)))).toBe(true);

    const p3 = await paginate(Order, { businessId: 'biz_pg', deletedAt: null }, { limit: 10, cursor: p2.nextCursor });
    expect(p3.items.length).toBe(5);
    expect(p3.nextCursor).toBeNull();
  });

  it('computes dashboard metrics via aggregation', async () => {
    const d = await analyticsService.dashboard('biz_pg', 'alltime');
    expect(d.totalOrders).toBe(25);
    expect(d.byStatus.PAID).toBe(12);
    expect(d.revenue).toBe(12 * 100);
    expect(d.totalExpenses).toBe(1200);
    expect(d.grossProfit).toBe(1200 - 1200);
    expect(Array.isArray(d.revenueByDay)).toBe(true);
    expect(d.expensesByCategory.length).toBe(2);
  });

  it('scopes aggregation to the tenant', async () => {
    const d = await analyticsService.dashboard('biz_other', 'alltime');
    expect(d.totalOrders).toBe(0);
  });
});
