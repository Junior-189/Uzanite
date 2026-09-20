import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Order = require('../../src/models/Order.js');
const Payment = require('../../src/models/Payment.js');
const LedgerEntry = require('../../src/models/LedgerEntry.js');
const StockMovement = require('../../src/models/StockMovement.js');
const Product = require('../../src/models/Product.js');
const ChatContact = require('../../src/models/ChatContact.js');
const ChatMessage = require('../../src/models/ChatMessage.js');
const paymentService = require('../../src/services/paymentService.js');
const { createManualOrder } = require('../../src/services/orderService.js');
const privacyService = require('../../src/services/privacyService.js');

let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('payments + ledger (DB-backed)', () => {
  it('manual confirmation creates an immutable payment + ledger and marks the order paid', async () => {
    const order = await Order.create({
      businessId: 'biz_p', orderNumber: 'ORD-P1', customerName: 'A',
      items: [], total: 5000, currency: 'TZS', status: 'PENDING',
    });
    const payment = await paymentService.confirmManual({
      businessId: 'biz_p', orderId: order._id, method: 'mpesa', reference: 'REF123',
    });
    expect(payment.status).toBe('succeeded');

    const updated = await Order.findById(order._id);
    expect(updated.status).toBe('PAID');
    expect(updated.paymentMethod).toBe('mpesa');

    const ledger = await LedgerEntry.find({ businessId: 'biz_p' });
    expect(ledger.length).toBe(1);
    expect(ledger[0].type).toBe('payment_in');
    expect(ledger[0].amount).toBe(5000);

    // Idempotent re-confirmation.
    const again = await paymentService.confirmManual({
      businessId: 'biz_p', orderId: order._id, method: 'mpesa', reference: 'REF123',
    });
    expect(String(again._id)).toBe(String(payment._id));
    expect(await Payment.countDocuments({ businessId: 'biz_p' })).toBe(1);
  });

  it('rejects mutation of immutable payment fields', async () => {
    const p = await Payment.create({
      businessId: 'biz_imm', provider: 'manual', method: 'cash',
      providerRef: 'IMM-1', amount: 1000, currency: 'TZS', status: 'succeeded',
    });
    p.amount = 999;
    await expect(p.save()).rejects.toThrow(/immutable/);
  });

  it('cash order records payment, ledger and stock movements atomically', async () => {
    const product = await Product.create({ businessId: 'biz_c', name: 'Soda', price: 1000, stock: 10 });
    const order = await createManualOrder({
      businessId: 'biz_c',
      customerName: 'Walk-in',
      items: [{ productId: String(product._id), productName: 'Soda', price: 1000, quantity: 2, subtotal: 2000, currency: 'TZS' }],
      recordedBy: 'Owner',
    });
    expect(order.status).toBe('PAID');
    expect(await Payment.countDocuments({ businessId: 'biz_c' })).toBe(1);
    expect(await LedgerEntry.countDocuments({ businessId: 'biz_c', type: 'cash_sale' })).toBe(1);

    const movements = await StockMovement.find({ businessId: 'biz_c' });
    expect(movements.length).toBe(1);
    expect(movements[0].quantity).toBe(-2);
    expect((await Product.findById(product._id)).stock).toBe(8);
  });

  it('applies a provider result idempotently (credits once)', async () => {
    const order = await Order.create({
      businessId: 'biz_w', orderNumber: 'ORD-W1', customerName: 'B',
      items: [], total: 3000, currency: 'TZS', status: 'PENDING_PAYMENT',
    });
    await Payment.create({
      businessId: 'biz_w', orderId: order._id, provider: 'clickpesa', method: 'mpesa',
      providerRef: 'PR-1', amount: 3000, currency: 'TZS', status: 'pending',
    });

    const r1 = await paymentService.applyResult({ providerName: 'clickpesa', providerRef: 'PR-1', status: 'success', raw: {} });
    expect(r1.payment.status).toBe('succeeded');
    const r2 = await paymentService.applyResult({ providerName: 'clickpesa', providerRef: 'PR-1', status: 'success', raw: {} });
    expect(r2.duplicate).toBe(true);
    expect(await LedgerEntry.countDocuments({ businessId: 'biz_w' })).toBe(1);
    expect((await Order.findById(order._id)).status).toBe('PAID');
  });

  it('erases a data subject (PDPA right to be forgotten)', async () => {
    await ChatContact.create({ businessId: 'biz_e', phone: '255700000000', name: 'X', email: 'x@y.com' });
    await ChatMessage.create({ businessId: 'biz_e', contactPhone: '255700000000', direction: 'inbound', text: 'hi' });
    const results = await privacyService.eraseDataSubject('biz_e', { phone: '255700000000' });
    expect(results.messages).toBe(1);
    expect(await ChatMessage.countDocuments({ businessId: 'biz_e' })).toBe(0);
    const c = await ChatContact.findOne({ businessId: 'biz_e', phone: '255700000000' });
    expect(c.name).toBe('REDACTED');
    expect(c.optIn).toBe(false);
  });

  it('exports tenant data', async () => {
    const data = await privacyService.exportTenant('biz_c');
    expect(data.businessId).toBe('biz_c');
    expect(Array.isArray(data.data.payments)).toBe(true);
    expect(data.data.payments.length).toBeGreaterThanOrEqual(1);
  });
});
