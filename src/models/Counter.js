const mongoose = require('mongoose');

// Atomic sequence counter used for race-free order numbers.
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // e.g. order:<businessId>:<yyyymmdd>
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Counter', counterSchema);
