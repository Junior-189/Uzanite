const Counter = require('../models/Counter');

// Atomically increments and returns the next value for a named sequence.
async function nextSequence(name, session = null) {
  const doc = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session, setDefaultsOnInsert: true }
  );
  return doc.seq;
}

// Pure formatter (unit-testable): ORD-YYYYMMDD-NNNN.
function formatOrderNumber(date, seq) {
  const ymd = new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${ymd}-${String(seq).padStart(4, '0')}`;
}

// Race-free order number: ORD-YYYYMMDD-NNNN, sequenced per tenant per day.
async function generateOrderNumber(businessId, session = null) {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = await nextSequence(`order:${businessId || 'default'}:${ymd}`, session);
  return formatOrderNumber(date, seq);
}

module.exports = { nextSequence, generateOrderNumber, formatOrderNumber };
