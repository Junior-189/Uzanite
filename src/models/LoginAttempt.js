const mongoose = require('mongoose');

const loginAttemptSchema = new mongoose.Schema({
  email: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },
  role: { type: String, default: '' },
  status: {
    type: String,
    enum: ['success', 'failed', 'pending', 'rejected', 'suspended', 'locked'],
    required: true,
  },
  reason: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  device: { type: String, default: '' },
  browser: { type: String, default: '' },
  os: { type: String, default: '' },
}, { timestamps: true });

loginAttemptSchema.index({ createdAt: -1 });
loginAttemptSchema.index({ email: 1 });
loginAttemptSchema.index({ status: 1 });

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);
