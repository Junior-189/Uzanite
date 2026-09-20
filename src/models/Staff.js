const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const staffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false, default: '' },
    googleId: { type: String, default: '' },
    avatar: { type: String, default: '' },
    businessId: { type: String, required: true, index: true },
    role: { type: String, default: 'staff' },
    permissions: [{
      type: String,
      enum: [
        'dashboard', 'orders', 'products', 'contacts', 'business',
        'whatsapp', 'broadcast', 'expenses', 'debts', 'purchases',
        'settings', 'notifications', 'recycleBin', 'reports'
      ],
    }],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastLogin: { type: Date },
    loginHistory: [{ type: Date }],
    // Incremented on password change to invalidate issued access tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

staffSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

staffSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('Staff', staffSchema);
