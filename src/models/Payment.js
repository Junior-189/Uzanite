const mongoose = require('mongoose');
const tenantScopePlugin = require('./plugins/tenantScope');

// Immutable payment record. Financial fields can never be changed after
// creation; only status/failure/proof/raw/confirmedAt may transition.
const paymentSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, default: 'default' },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    provider: {
      type: String,
      enum: ['manual', 'clickpesa', 'azampay'],
      default: 'manual',
    },
    method: { type: String, default: 'manual' }, // mpesa | tigo | airtel | card | cash | manual
    providerRef: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'TZS' },
    phone: { type: String, default: '' },
    status: {
      type: String,
      enum: ['initiated', 'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded'],
      default: 'initiated',
    },
    failureReason: { type: String, default: '' },
    proofPath: { type: String, default: null },
    raw: { type: Object, default: {} },
    initiatedBy: { type: String, default: '' },
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

paymentSchema.plugin(tenantScopePlugin);
paymentSchema.index({ businessId: 1, orderId: 1, createdAt: -1 });
paymentSchema.index({ businessId: 1, _id: -1 });
paymentSchema.index({ providerRef: 1 }, { unique: true, sparse: true });
paymentSchema.index(
  { businessId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

const IMMUTABLE_FIELDS = ['businessId', 'orderId', 'provider', 'amount', 'currency', 'idempotencyKey'];

paymentSchema.pre('save', function guardImmutable(next) {
  if (this.isNew) return next();
  for (const f of IMMUTABLE_FIELDS) {
    if (this.isModified(f)) return next(new Error(`Payment field "${f}" is immutable`));
  }
  next();
});

paymentSchema.pre('findOneAndUpdate', function immutableUpdate(next) {
  const update = this.getUpdate() || {};
  const set = update.$set || update;
  for (const f of IMMUTABLE_FIELDS) {
    if (set[f] !== undefined) return next(new Error(`Payment field "${f}" is immutable`));
  }
  next();
});

module.exports = mongoose.model('Payment', paymentSchema);
