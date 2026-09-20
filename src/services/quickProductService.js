/**
 * QUICK PRODUCT UPLOAD VIA WHATSAPP
 * Allows admins to quickly upload products with prices directly from WhatsApp
 * 
 * Usage:
 *   QUICK_ADD <name>|<description>|<price>|<stock>
 *   Example: QUICK_ADD iPhone 15|Latest smartphone|3500000|25
 * 
 * With image (send image with caption):
 *   QUICK_ADD_IMAGE <name>|<description>|<price>|<stock>
 */

const Product = require('../models/Product');
const { addToCart } = require('./sessionService');
const ChatContact = require('../models/ChatContact');
const { canSendFreeForm } = require('./notificationService');
const { createNotification } = require('./notificationStore');
const { toPublicPath, toDiskPath } = require('../config/uploads');
const fs = require('fs');
const path = require('path');

/**
 * Parse product data from message
 * Format: QUICK_ADD name|description|price|stock
 */
const parseProductData = (text) => {
  const match = text.match(/QUICK_ADD\s+(.+)/i);
  if (!match) return null;

  const parts = match[1].split('|').map(p => p.trim());
  if (parts.length < 3) return null;

  return {
    name: parts[0],
    description: parts[1] || 'Product added via WhatsApp',
    price: Number(parts[2]),
    stock: parts[3] ? Number(parts[3]) : 0,
  };
};

/**
 * Handle quick product upload from admin
 * Can include image if sent as media
 */
const handleQuickProductUpload = async (sock, sender, text, imagePath, businessId = 'default') => {
  try {
    const productData = parseProductData(text);
    
    if (!productData || isNaN(productData.price) || productData.price < 0) {
      return sock.sendMessage(sender, {
        text: `❌ Invalid format!\n\n*Usage:*\nQUICK_ADD <name>|<description>|<price>|<stock>\n\n` +
              `*Example:*\nQUICK_ADD iPhone 15|Latest smartphone|3500000|25\n\n` +
              `*Price must be a number!*`
      });
    }

    // Create product
    const product = await Product.create({
      businessId,
      name: productData.name,
      description: productData.description,
      price: productData.price,
      currency: 'TZS',
      stock: productData.stock,
      imagePath: imagePath || null, // Image path if uploaded
      active: true,
    });

    console.log(`✅ Quick product created: ${product.name} - TZS ${product.price.toLocaleString()}`);

    // Get all active contacts for this business
    const contacts = await ChatContact.find({ businessId, messageCount: { $gte: 1 } });
    
    // Broadcast to all customers (respecting 24h window and opt-in)
    let broadcastCount = 0;
    let skippedCount = 0;
    for (const contact of contacts) {
      try {
        const check = await canSendFreeForm(contact.phone, businessId);
        if (!check.canSend) {
          skippedCount++;
          continue;
        }
        
        const contactJid = contact.jid || `${contact.phone}@s.whatsapp.net`;
        
        // Send image if available
        const productDetail = `🆕 *NEW PRODUCT!*\n\n` +
          `📦 *${product.name}*\n\n` +
          `${product.description}\n\n` +
          `💰 *Price:* TZS ${product.price.toLocaleString()}\n` +
          `📊 *Stock:* ${product.stock} available\n` +
          `\n*Type "1" to browse all products!*`;

        if (product.imagePath) {
          const imgFullPath = toDiskPath(product.imagePath);
          if (fs.existsSync(imgFullPath)) {
            try {
              const buffer = fs.readFileSync(imgFullPath);
              await sock.sendMessage(contactJid, { 
                image: buffer, 
                caption: productDetail 
              });
              broadcastCount++;
            } catch (err) {
              console.warn(`⚠️  Failed to send image to ${contact.phone}:`, err.message);
              // Fallback to text
              await sock.sendMessage(contactJid, { text: productDetail });
              broadcastCount++;
            }
          } else {
            // Image path set but file doesn't exist
            await sock.sendMessage(contactJid, { text: productDetail });
            broadcastCount++;
          }
        } else {
          // No image, send text only
          await sock.sendMessage(contactJid, { text: productDetail });
          broadcastCount++;
        }
      } catch (err) {
        console.error(`Error broadcasting to ${contact.phone}:`, err.message);
      }
    }

    // Confirm to admin
    if (broadcastCount > 0) {
      createNotification({ businessId, type: 'broadcast_sent', title: 'Broadcast Sent', message: `New product "${product.name}" broadcast to ${broadcastCount} contacts (${skippedCount} skipped)`, data: { productId: product._id.toString(), sent: broadcastCount, skipped: skippedCount } });
    } else {
      createNotification({ businessId, type: 'broadcast_failed', title: 'Broadcast Failed', message: `New product "${product.name}" broadcast failed: all ${skippedCount} contacts skipped`, data: { productId: product._id.toString() }, priority: 'high' });
    }
    const imageInfo = product.imagePath ? `\n🖼️  Image: ✅ Included` : `\n🖼️  Image: ❌ None`;
    return sock.sendMessage(sender, {
      text: `✅ *Product Added Successfully!*\n\n` +
            `📦 *${product.name}*\n` +
            `💰 Price: TZS ${product.price.toLocaleString()}\n` +
            `📊 Stock: ${product.stock}\n` +
            `📢 Broadcast: ✅ ${broadcastCount} customers notified, ${skippedCount} skipped (outside 24h/opted out)${imageInfo}`
    });

  } catch (err) {
    console.error('Error in quick product upload:', err);
    return sock.sendMessage(sender, {
      text: `❌ Error creating product: ${err.message}`
    });
  }
};

/**
 * Handle image upload for quick product
 * Send image with caption containing product details
 */
const handleQuickProductWithImage = async (sock, sender, text, imageBuffer, businessId = 'default') => {
  try {
    const productData = parseProductData(text);
    
    if (!productData || isNaN(productData.price)) {
      return sock.sendMessage(sender, {
        text: `❌ Invalid format!\n\nSend image with caption:\nQUICK_ADD_IMAGE <name>|<description>|<price>|<stock>`
      });
    }

    // Save image to the (persistent) uploads folder
    const imageName = `product-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const diskPath = toDiskPath(imageName);

    // Write buffer to file
    fs.writeFileSync(diskPath, imageBuffer);

    // Create product with image (store the public URL path in DB)
    const product = await Product.create({
      businessId,
      name: productData.name,
      description: productData.description,
      price: productData.price,
      currency: 'TZS',
      stock: productData.stock,
      imagePath: toPublicPath(imageName),
      active: true,
    });

    console.log(`✅ Quick product with image created: ${product.name}`);

    // Broadcast to customers (respecting 24h window and opt-in)
    const contacts = await ChatContact.find({ businessId, messageCount: { $gte: 1 } });
    
    let broadcastCount = 0;
    let skippedCount = 0;
    for (const contact of contacts) {
      try {
        const check = await canSendFreeForm(contact.phone, businessId);
        if (!check.canSend) {
          skippedCount++;
          continue;
        }
        
        const contactJid = contact.jid || `${contact.phone}@s.whatsapp.net`;
        
        const productDetail = `🆕 *NEW PRODUCT!*\n\n` +
          `📦 *${product.name}*\n\n` +
          `${product.description}\n\n` +
          `💰 *Price:* TZS ${product.price.toLocaleString()}\n` +
          `📊 *Stock:* ${product.stock} available\n` +
          `\n*Type "1" to browse all products!*`;

        await sock.sendMessage(contactJid, { 
          image: imageBuffer, 
          caption: productDetail 
        });
        broadcastCount++;
      } catch (err) {
        console.error(`Error broadcasting to ${contact.phone}:`, err.message);
      }
    }

    if (broadcastCount > 0) {
      createNotification({ businessId, type: 'broadcast_sent', title: 'Broadcast Sent', message: `New product "${product.name}" (with image) broadcast to ${broadcastCount} contacts (${skippedCount} skipped)`, data: { productId: product._id.toString(), sent: broadcastCount, skipped: skippedCount } });
    } else {
      createNotification({ businessId, type: 'broadcast_failed', title: 'Broadcast Failed', message: `New product "${product.name}" (with image) broadcast failed: all ${skippedCount} contacts skipped`, data: { productId: product._id.toString() }, priority: 'high' });
    }
    return sock.sendMessage(sender, {
      text: `✅ *Product Added Successfully!*\n\n` +
            `📦 *${product.name}*\n` +
            `💰 Price: TZS ${product.price.toLocaleString()}\n` +
            `📊 Stock: ${product.stock}\n` +
            `🖼️  Image: ✅ Included\n` +
            `📢 Broadcast: ✅ ${broadcastCount} customers notified, ${skippedCount} skipped (outside 24h/opted out)`
    });

  } catch (err) {
    console.error('Error in quick product with image:', err);
    return sock.sendMessage(sender, {
      text: `❌ Error: ${err.message}`
    });
  }
};

module.exports = { handleQuickProductUpload, handleQuickProductWithImage, parseProductData };
