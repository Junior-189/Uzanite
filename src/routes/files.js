// Serves private local-storage objects via short-lived HMAC-signed URLs.
// (When S3/R2 is configured, signed URLs point directly at the bucket instead.)
const express = require('express');
const router = express.Router();
const storage = require('../services/storageService');
const StoredFile = require('../models/StoredFile');

// Only these raster image types are served `inline`. Everything else (including
// SVG and any client-declared text/html) is forced to a download as an opaque
// stream, so a malicious upload can never execute on the app origin.
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']);

// Strip quotes/control characters so the value cannot break out of the header.
function safeFilename(value) {
  return String(value || 'file')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 120);
}

router.get('/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const { exp, sig } = req.query;
    if (!storage.verifyLocalSignature(key, exp, sig)) {
      return res.status(403).json({ success: false, error: 'Invalid or expired link' });
    }
    const file = await StoredFile.findOne({ key }).lean();
    const buffer = await storage.getObjectBuffer(key);

    const declared = (file && file.contentType) || '';
    const inline = INLINE_IMAGE_TYPES.has(declared);
    const contentType = inline ? declared : 'application/octet-stream';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Neutralises any active content even if a browser ignores the type.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(key.split('/').pop())}"`);
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

module.exports = router;
