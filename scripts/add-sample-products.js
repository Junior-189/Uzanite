#!/usr/bin/env node

/**
 * ✨ Sample Product Loader
 * 
 * This script adds sample products to your MongoDB database.
 * Products have placeholder imagePath values (you can add real images later).
 * 
 * Usage:
 *   node scripts/add-sample-products.js
 * 
 * Requirements:
 *   - MongoDB running and connection configured in .env
 *   - mongoose installed (already in package.json)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_saas');
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

// Product Model
const productSchema = new mongoose.Schema({
  businessId: { type: String, required: true, default: 'default' },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'TZS' },
  stock: { type: Number, default: -1 },
  imagePath: { type: String, default: null },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Product = mongoose.model('Product', productSchema);

// Sample products for Tanzania market
const sampleProducts = [
  {
    name: 'iPhone 15 Pro Max',
    description: 'Latest Apple smartphone with A17 Pro chip, 6.7" Super Retina XDR display, advanced camera system, and 48MP main camera. Perfect for photography and performance.',
    price: 3500000,
    currency: 'TZS',
    stock: 25,
    businessId: 'default',
    imagePath: 'uploads/product-iphone15.jpg',
  },
  {
    name: 'Samsung Galaxy S24',
    description: 'Flagship Android phone with Galaxy AI, 50MP main camera, 120Hz display, and all-day battery life. Powered by Snapdragon 8 Gen 3 Leading Version.',
    price: 2800000,
    currency: 'TZS',
    stock: 30,
    businessId: 'default',
    imagePath: 'uploads/product-samsung-s24.jpg',
  },
  {
    name: 'AirPods Pro (2nd Gen)',
    description: 'Premium wireless earbuds with active noise cancellation, adaptive audio, conversation awareness, and seamless Apple device integration. Up to 6 hours listening time.',
    price: 800000,
    currency: 'TZS',
    stock: 50,
    businessId: 'default',
    imagePath: 'uploads/product-airpods-pro.jpg',
  },
  {
    name: 'iPad Air',
    description: '11-inch iPad Air with M1 chip, landscape 12MP Ultra Wide front camera, stunning display, and all-day battery. Great for creativity and productivity.',
    price: 2000000,
    currency: 'TZS',
    stock: 15,
    businessId: 'default',
    imagePath: 'uploads/product-ipad-air.jpg',
  },
  {
    name: 'MacBook Air M3',
    description: 'Lightweight and powerful laptop with M3 chip, 13.6" Liquid Retina display, 8GB unified memory, and excellent battery life. Perfect for work and creativity.',
    price: 4500000,
    currency: 'TZS',
    stock: 10,
    businessId: 'default',
    imagePath: 'uploads/product-macbook-air-m3.jpg',
  },
  {
    name: 'Apple Watch Series 9',
    description: 'Advanced health and fitness tracker with Always-On Retina display, blood oxygen monitoring, ECG app, temperature sensing, and workout tracking.',
    price: 1500000,
    currency: 'TZS',
    stock: 40,
    businessId: 'default',
    imagePath: 'uploads/product-apple-watch-s9.jpg',
  },
  {
    name: 'Sony WH-1000XM5 Headphones',
    description: 'Industry-leading noise cancellation, 30-hour battery life, premium audio quality, and comfortable design for all-day wear. Perfect for music lovers.',
    price: 1200000,
    currency: 'TZS',
    stock: 20,
    businessId: 'default',
    imagePath: 'uploads/product-sony-headphones.jpg',
  },
  {
    name: 'Samsung 4K Smart TV 55"',
    description: 'Crystal UHD 4K display with AI Upscaling, 60Hz refresh rate, Smart TV with streaming apps, and sleek design. Perfect entertainment experience.',
    price: 1800000,
    currency: 'TZS',
    stock: 8,
    businessId: 'default',
    imagePath: 'uploads/product-samsung-tv.jpg',
  },
  {
    name: 'Dell XPS 15 Laptop',
    description: 'Powerful Windows laptop with Intel Core i7 processor, RTX 4050 graphics, 15.6" 4K display, and premium build quality. Ideal for professionals.',
    price: 3200000,
    currency: 'TZS',
    stock: 12,
    businessId: 'default',
    imagePath: 'uploads/product-dell-xps.jpg',
  },
  {
    name: 'DJI Air 3S Drone',
    description: 'Compact and powerful drone with 48MP camera, 46-minute flight time, 10km transmission range, and 4K video. Perfect for aerial photography.',
    price: 2500000,
    currency: 'TZS',
    stock: 5,
    businessId: 'default',
    imagePath: 'uploads/product-dji-drone.jpg',
  },
];

// Main function
const addProducts = async () => {
  try {
    await connectDB();

    // Check if products already exist
    const existingCount = await Product.countDocuments({ businessId: 'default' });
    if (existingCount > 0) {
      console.log(`\n⚠️  Found ${existingCount} existing products. Skipping to avoid duplicates.`);
      console.log('\n💡 To delete all products and start fresh, run:');
      console.log('   db.products.deleteMany({ businessId: "default" })\n');
      process.exit(0);
    }

    console.log('\n🚀 Adding sample products...\n');

    const created = await Product.insertMany(
      sampleProducts.map(p => ({
        ...p,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    );

    console.log(`✅ Successfully added ${created.length} products!\n`);

    // Display summary
    console.log('📦 Product Summary:');
    console.log('─────────────────────────────────────────');
    created.forEach((p, i) => {
      console.log(`${i + 1}. ${p.name}`);
      console.log(`   Price: TZS ${p.price.toLocaleString()}`);
      console.log(`   Stock: ${p.stock === -1 ? 'Unlimited' : p.stock}`);
      console.log(`   Image Path: ${p.imagePath}`);
      console.log();
    });

    console.log('─────────────────────────────────────────');
    console.log(`Total Products: ${created.length}`);
    const totalValue = created.reduce((sum, p) => sum + (p.price * p.stock), 0);
    console.log(`Total Stock Value: TZS ${totalValue.toLocaleString()}`);
    console.log('\n✨ Next steps:');
    console.log('   1. Add real images to the uploads/ folder');
    console.log('   2. Send a message to your WhatsApp number');
    console.log('   3. Reply "1" to browse products');
    console.log('   4. Reply "1" to view first product with image\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
};

// Run the script
addProducts();
