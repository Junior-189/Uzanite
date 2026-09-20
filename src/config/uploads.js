const path = require('path');
const fs = require('fs');

const rawUploadDir = process.env.UPLOAD_DIR || 'uploads';

const uploadDirAbs = path.isAbsolute(rawUploadDir)
  ? rawUploadDir
  : path.join(process.cwd(), rawUploadDir);

if (!fs.existsSync(uploadDirAbs)) fs.mkdirSync(uploadDirAbs, { recursive: true });

function toPublicPath(fileOrName) {
  return 'uploads/' + path.basename(fileOrName || '');
}

function toDiskPath(storedPathOrName) {
  return path.join(uploadDirAbs, path.basename(storedPathOrName || ''));
}

module.exports = { uploadDirAbs, toPublicPath, toDiskPath };
