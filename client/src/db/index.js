import Dexie from 'dexie';

const db = new Dexie('WhatsAppSaaS');

db.version(1).stores({
  products: '++id, name, category, createdAt, syncStatus',
  orders: '++id, orderNumber, customerId, status, source, createdAt, syncStatus',
  contacts: '++id, name, phone, createdAt, syncStatus',
  expenses: '++id, category, date, createdAt, syncStatus',
  purchases: '++id, productId, date, createdAt, syncStatus',
  debts: '++id, customerName, status, createdAt, syncStatus',
  staff: '++id, name, email, role, syncStatus',
  settings: 'key',
  syncQueue: '++id, action, entity, entityId, timestamp, retries',
  dashboardCache: 'key',
});

db.version(2).stores({
  products: '++id, name, barcode, category, createdAt, syncStatus',
});

export default db;
