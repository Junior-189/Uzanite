const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
  {
    businessId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true }, // Admin WhatsApp number
    description: { type: String, default: '' },
    currency: { type: String, default: 'TZS' },
    // Payment info
    payment: {
      mpesa: { number: String, name: String },
      tigo: { number: String },
      airtel: { number: String },
    },
    active: { type: Boolean, default: true },
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Business', businessSchema);
