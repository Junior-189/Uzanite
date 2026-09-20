const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false, default: '' },
    phone: { type: String, default: '' },
    // Google OAuth
    googleId: { type: String, default: '' },
    avatar: { type: String, default: '' },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    role: {
      type: String,
      enum: ['super_admin', 'sub_admin', 'tenant'],
      default: 'tenant',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    businessId: { type: String, unique: true, sparse: true },
    businessName: { type: String, default: '' },
    // WhatsApp session folder name
    sessionId: { type: String, default: '' },
    whatsappConnected: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    permissions: [{ type: String }],
    // Forces a password change on next login (used for secure bootstrap accounts).
    mustChangePassword: { type: Boolean, default: false },
    approvedAt: { type: Date },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Soft delete
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Reason set by admin when rejecting an account (emailed to the user)
    rejectionReason: { type: String, default: '' },
    // Self-service password reset (hashed token + expiry)
    resetToken: { type: String, default: '' },
    resetTokenExpiry: { type: Date, default: null },
    // Incremented on password change/suspend to invalidate issued access tokens.
    tokenVersion: { type: Number, default: 0 },
    // SaaS subscription (Phase 4).
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'trialing', 'past_due', 'canceled'],
      default: 'active',
    },
    trialEndsAt: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    // Throttle timestamp for unverified-login reminder emails
    lastUnverifiedEmailAt: { type: Date, default: null },
    // Tenant UI theme preference ('light' | 'dark')
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);