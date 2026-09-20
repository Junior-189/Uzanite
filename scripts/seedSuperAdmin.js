/**
 * Secure super-admin bootstrap (Phase 0).
 *
 * Replaces the old hardcoded `admin@whatsappsaas.com / Admin@123` seed.
 * Credentials MUST be supplied via environment variables and the account is
 * flagged `mustChangePassword` so the operator changes it on first login.
 *
 * Usage:
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='Str0ng!Passw0rd' \
 *   MONGODB_URI="..." node scripts/seedSuperAdmin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../src/models/User');

function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least 1 uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('At least 1 lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least 1 number');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('At least 1 special character');
  return errors;
}

const seedSuperAdmin = async () => {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.error('❌ BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.');
    process.exit(1);
  }
  const pwErrors = validatePassword(password);
  if (pwErrors.length) {
    console.error(`❌ Weak BOOTSTRAP_ADMIN_PASSWORD: ${pwErrors.join(', ')}`);
    process.exit(1);
  }

  try {
    const dbUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_saas';
    await mongoose.connect(dbUrl);
    console.log('✅ MongoDB connected');

    const existing = await User.findOne({ role: 'super_admin' });
    if (existing) {
      console.log(`ℹ️  Super admin already exists: ${existing.email}`);
      console.log('   No changes made. Delete the account first if you need to recreate it.');
      await mongoose.disconnect();
      return;
    }

    await User.create({
      name: 'Super Admin',
      email,
      password,
      phone: '',
      role: 'super_admin',
      status: 'approved',
      businessId: 'super-admin',
      businessName: 'UZANITE Admin',
      approvedAt: new Date(),
      mustChangePassword: true,
    });

    console.log('\n✅ Super Admin created successfully.');
    console.log(`   Email: ${email}`);
    console.log('   A password change is required at first login.');
    console.log('   (The password is never printed or stored in plaintext.)\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding super admin:', err.message);
    process.exit(1);
  }
};

seedSuperAdmin();
