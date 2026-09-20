const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },
  userEmail: { type: String, default: '' },
  sessionId: { type: String, default: '' },
  page: { type: String, required: true },
  action: { type: String, enum: ['visit', 'navigate', 'leave'], default: 'visit' },
  duration: { type: Number, default: 0 },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  device: { type: String, default: '' },
  browser: { type: String, default: '' },
  os: { type: String, default: '' },
  referrer: { type: String, default: '' },
  businessId: { type: String, default: 'default' },
}, { timestamps: true });

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userId: 1 });
activityLogSchema.index({ page: 1 });
activityLogSchema.index({ sessionId: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
