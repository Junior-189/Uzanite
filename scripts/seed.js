/**
 * Seed script — adds sample products to get started quickly.
 * Run: node scripts/seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../src/models/Product');
const Business = require('../src/models/Business');

const BUSINESS_ID = process.env.BUSINESS_ID || 'default';

const sampleProducts = [
  {
    name: 'Men\'s Cotton T-Shirt',
    description: 'High quality 100% cotton. Available in Black, White, Navy. Sizes S–XL.',
    price: 15000,
    currency: 'TZS',
    stock: 100,
    businessId: BUSINESS_ID,
  },
  {
    name: 'Women\'s Dress',
    description: 'Floral print, lightweight fabric. Perfect for all occasions.',
    price: 35000,
    currency: 'TZS',
    stock: 50,
    businessId: BUSINESS_ID,
  },
  {
    name: 'Leather Wallet',
    description: 'Genuine leather, 8 card slots, coin pocket.',
    price: 25000,
    currency: 'TZS',
    stock: 30,
    businessId: BUSINESS_ID,
  },
  {
    name: 'Wireless Earbuds',
    description: 'Bluetooth 5.0, 24hr battery life, noise cancelling.',
    price: 85000,
    currency: 'TZS',
    stock: 20,
    businessId: BUSINESS_ID,
  },
  {
    name: 'Phone Case (Universal)',
    description: 'Fits most Android phones. Shockproof, waterproof.',
    price: 8000,
    currency: 'TZS',
    stock: -1,
    businessId: BUSINESS_ID,
  },
];

const sampleBusiness = {
  businessId: BUSINESS_ID,
  name: process.env.BUSINESS_NAME || 'FEDE AI',
  phone: process.env.ADMIN_PHONE || '255700000000',
  description: 'Quality products delivered to your door.',
  payment: {
    mpesa: { number: process.env.MPESA_NUMBER || '255700000000', name: process.env.MPESA_NAME || 'Shop Owner' },
    tigo: { number: process.env.TIGO_NUMBER || '255600000000' },
    airtel: { number: process.env.AIRTEL_NUMBER || '255680000000' },
  },
};

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  // Upsert business
  await Business.findOneAndUpdate({ businessId: BUSINESS_ID }, sampleBusiness, { upsert: true });
  console.log(`✅ Business "${sampleBusiness.name}" seeded`);

  // Insert products (skip if already exist)
  for (const p of sampleProducts) {
    const exists = await Product.findOne({ name: p.name, businessId: p.businessId });
    if (!exists) {
      await Product.create(p);
      console.log(`✅ Product "${p.name}" added`);
    } else {
      console.log(`⏭️  Product "${p.name}" already exists, skipping`);
    }
  }

  console.log('\n🎉 Seed complete! Start the server with: npm run dev');
  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
