const multer = require('multer');
const path = require('path');
const { uploadDirAbs } = require('../config/uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirAbs),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `product-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const memoryStorage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
};

const csvFilter = (req, file, cb) => {
  const allowed = ['.csv'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only CSV files are allowed'));
};

const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max
const uploadCsv = multer({ storage, fileFilter: csvFilter, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB max for CSV
const uploadMemory = multer({ storage: memoryStorage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max, in-memory for Cloudinary

module.exports = { upload, uploadCsv, uploadMemory };
