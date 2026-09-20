const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { uploadDirAbs, toPublicPath } = require('../config/uploads');

// Cloudinary is considered configured if EITHER the three separate vars are
// present OR the single CLOUDINARY_URL connection string is provided. The SDK
// auto-parses CLOUDINARY_URL, so we only need to call config() for the split vars.
const cloudinaryConfigured = !!(
  process.env.CLOUDINARY_URL ||
  (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
);

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Compress + resize on the server to keep stored bytes small.
async function optimize(buffer, { maxWidth = 800, quality = 65 } = {}) {
  return sharp(buffer)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargements: true })
    .jpeg({ quality, progressive: true, mozjpeg: true })
    .toBuffer();
}

// Upload a product image. Uses Cloudinary when configured; otherwise falls
// back to local disk storage (served via the /uploads static route) so images
// always work even without Cloudinary credentials.
async function uploadImage(buffer, { folder = 'uzer/products', maxWidth = 800, quality = 65 } = {}) {
  if (cloudinaryConfigured) {
    const optimized = await optimize(buffer, { maxWidth, quality });
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image', overwrite: true },
        (error, res) => (error ? reject(error) : resolve(res))
      );
      uploadStream.end(optimized);
    });
    return result.secure_url;
  }

  // ── Local disk fallback ──
  const optimized = await optimize(buffer, { maxWidth, quality });
  const name = `product-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  fs.writeFileSync(path.join(uploadDirAbs, name), optimized);
  return toPublicPath(name);
}

module.exports = { uploadImage, cloudinaryConfigured };

