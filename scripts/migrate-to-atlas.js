const mongoose = require('mongoose');

const LOCAL_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_saas';
const ATLAS_URI = process.env.ATLAS_URI;

if (!ATLAS_URI) {
  console.error('❌ Set ATLAS_URI env var first:');
  console.error('   node scripts/migrate-to-atlas.js "mongodb+srv://user:pass@cluster.mongodb.net/whatsapp_saas?retryWrites=true&w=majority"');
  process.exit(1);
}

const COLLECTIONS_TO_MIGRATE = [
  'users', 'products', 'orders', 'contacts', 'businesses',
  'staffs', 'expenses', 'debts', 'purchases', 'notifications',
  'chatcontacts', 'chatmessages', 'stocknotifications',
];

async function migrate() {
  console.log('🔄 Connecting to local MongoDB...');
  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
  const localDb = localConn.db;

  console.log('🔄 Connecting to Atlas...');
  const atlasConn = await mongoose.createConnection(ATLAS_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  }).asPromise();
  const atlasDb = atlasConn.db;

  let totalDocs = 0;

  for (const collName of COLLECTIONS_TO_MIGRATE) {
    const count = await localDb.collection(collName).countDocuments();
    if (count === 0) {
      console.log(`⏭️  ${collName}: empty, skipping`);
      continue;
    }

    console.log(`📦 ${collName}: migrating ${count} docs...`);

    const docs = await localDb.collection(collName).find({}).toArray();

    if (docs.length > 0) {
      await atlasDb.collection(collName).deleteMany({});
      await atlasDb.collection(collName).insertMany(docs, { ordered: false });
    }

    console.log(`✅ ${collName}: ${docs.length} docs migrated`);
    totalDocs += docs.length;
  }

  console.log(`\n🎉 Migration complete! ${totalDocs} documents migrated to Atlas.`);

  await localConn.close();
  await atlasConn.close();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
