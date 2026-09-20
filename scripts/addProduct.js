/**
 * Quick CLI to add a product.
 * Usage: node scripts/addProduct.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const Product = require('../src/models/Product');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log('\n📦 Add New Product\n');

  const name = await ask('Product name: ');
  const description = await ask('Description: ');
  const price = await ask('Price (TZS): ');
  const stock = await ask('Stock (-1 for unlimited): ');

  const product = await Product.create({
    name: name.trim(),
    description: description.trim(),
    price: Number(price),
    currency: 'TZS',
    stock: Number(stock),
    businessId: process.env.BUSINESS_ID || 'default',
  });

  console.log(`\n✅ Product added! ID: ${product._id}`);
  rl.close();
  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
