/**
 * Phase 1 index migration.
 *
 * Reconciles MongoDB indexes with the new schema (compound/tenant indexes and
 * the orderNumber/barcode/phone uniqueness changes). Uses Model.syncIndexes()
 * which drops obsolete indexes and builds the new ones.
 *
 * Run once after deploying Phase 1:
 *   MONGODB_URI="..." node scripts/migrate-phase1-indexes.js
 *
 * NOTE: if duplicate data exists for a new unique index the build will fail;
 * the script reports which model failed so it can be cleaned and retried.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MODELS = [
  'User', 'Business', 'Product', 'Order', 'Staff', 'Debt', 'Expense', 'Purchase',
  'Session', 'ChatContact', 'ChatMessage', 'Notification', 'EmailLog',
  'StockNotification', 'Counter', 'RefreshToken', 'ActivityLog', 'LoginAttempt',
  // Phase 2
  'WhatsAppAccount', 'WebhookEvent',
  // Phase 3
  'Payment', 'LedgerEntry', 'StockMovement', 'ConsentLog', 'StoredFile',
  // Phase 4
  'UsageCounter',
];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is required.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  let failures = 0;
  for (const name of MODELS) {
    try {
      const Model = require(`../src/models/${name}`);
      const dropped = await Model.syncIndexes();
      console.log(`✅ ${name}: indexes synced${dropped && dropped.length ? ` (dropped: ${dropped.join(', ')})` : ''}`);
    } catch (err) {
      failures++;
      console.error(`❌ ${name}: ${err.message}`);
    }
  }

  await mongoose.disconnect();
  if (failures > 0) {
    console.error(`\n⚠️  ${failures} model(s) failed. Resolve duplicate data and re-run.`);
    process.exit(1);
  }
  console.log('\n✅ Index migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
