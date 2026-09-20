// PDPA helpers: data export and right-to-erasure.
const Business = require('../models/Business');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Debt = require('../models/Debt');
const Expense = require('../models/Expense');
const Purchase = require('../models/Purchase');
const ChatContact = require('../models/ChatContact');
const ChatMessage = require('../models/ChatMessage');
const Notification = require('../models/Notification');
const LedgerEntry = require('../models/LedgerEntry');
const StockMovement = require('../models/StockMovement');
const Staff = require('../models/Staff');
const ConsentLog = require('../models/ConsentLog');
const StoredFile = require('../models/StoredFile');
const Session = require('../models/Session');

const TENANT_MODELS = {
  businesses: Business,
  products: Product,
  orders: Order,
  payments: Payment,
  debts: Debt,
  expenses: Expense,
  purchases: Purchase,
  contacts: ChatContact,
  messages: ChatMessage,
  notifications: Notification,
  ledger: LedgerEntry,
  stockMovements: StockMovement,
  staff: Staff,
  consentLogs: ConsentLog,
  storedFiles: StoredFile,
};

// Full tenant data export (JSON).
async function exportTenant(businessId) {
  const out = { businessId, exportedAt: new Date().toISOString(), data: {} };
  for (const [name, Model] of Object.entries(TENANT_MODELS)) {
    try {
      out.data[name] = await Model.find({ businessId }).lean();
    } catch {
      out.data[name] = [];
    }
  }
  return out;
}

// Erase a single data subject (customer) within a tenant.
async function eraseDataSubject(businessId, { phone, email } = {}) {
  const results = {};
  const phoneDigits = phone ? String(phone).replace(/\D/g, '') : null;
  const emailLc = email ? String(email).trim().toLowerCase() : null;

  if (phoneDigits) {
    results.messages = (await ChatMessage.deleteMany({ businessId, contactPhone: phoneDigits })).deletedCount;
    results.sessions = (await Session.deleteMany({ businessId, phone: phoneDigits })).deletedCount;
    results.contacts = (
      await ChatContact.updateMany(
        { businessId, phone: phoneDigits },
        { $set: { name: 'REDACTED', email: '', optIn: false, unsubscribedAt: new Date() } }
      )
    ).modifiedCount;
    results.consentLogs = (await ConsentLog.deleteMany({ businessId, phone: phoneDigits })).deletedCount;
  }

  if (emailLc) {
    results.contactsEmail = (
      await ChatContact.updateMany({ businessId, email: emailLc }, { $set: { email: '' } })
    ).modifiedCount;
    results.consentLogsEmail = (await ConsentLog.deleteMany({ businessId, email: emailLc })).deletedCount;
  }

  return results;
}

// Hard-delete every record for a tenant (admin/super-admin only).
async function eraseTenant(businessId) {
  const counts = {};
  for (const [name, Model] of Object.entries(TENANT_MODELS)) {
    try {
      counts[name] = (await Model.deleteMany({ businessId })).deletedCount;
    } catch {
      counts[name] = 0;
    }
  }
  return counts;
}

module.exports = { exportTenant, eraseDataSubject, eraseTenant, TENANT_MODELS };
