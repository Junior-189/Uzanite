/**
 * Phase 0 data migration — safe & idempotent.
 *
 * Removes the plaintext `initialPassword` field from every user document.
 * Run AFTER deploying the Phase 0 code (the model no longer declares the field,
 * but existing rows still contain it).
 *
 * Usage:
 *   MONGODB_URI="..." node scripts/migrate-phase0.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is required.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  const users = mongoose.connection.collection('users');
  const withPlain = await users.countDocuments({ initialPassword: { $exists: true } });
  console.log(`ℹ️  Users still carrying a plaintext initialPassword: ${withPlain}`);

  const result = await users.updateMany(
    { initialPassword: { $exists: true } },
    { $unset: { initialPassword: '' } }
  );
  console.log(`✅ Removed initialPassword from ${result.modifiedCount} user document(s).`);

  await mongoose.disconnect();
  console.log('✅ Migration complete.');
}

run().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
