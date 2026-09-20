const Session = require('../models/Session');

// AUDIT FIX (V3/V27): every session operation is now keyed by
// (phone, businessId). Previously the code queried by phone only, so a customer
// messaging two different tenants shared one session (cart/step/language leaked
// across tenants) despite the composite unique index on the model.

const getSession = async (phone, businessId = 'default') => {
  let session = await Session.findOne({ phone, businessId });
  if (!session) {
    session = await Session.create({
      phone,
      businessId,
      step: 'MAIN_MENU',
      cart: [],
      context: {},
    });
  }
  session.lastActivity = new Date();
  await session.save();
  return session;
};

const updateSession = async (phone, businessId = 'default', updates = {}) => {
  return Session.findOneAndUpdate(
    { phone, businessId },
    { ...updates, lastActivity: new Date() },
    { new: true, upsert: true }
  );
};

const resetSession = async (phone, businessId = 'default') => {
  return Session.findOneAndUpdate(
    { phone, businessId },
    { step: 'MAIN_MENU', cart: [], context: {}, lastActivity: new Date() },
    { new: true, upsert: true }
  );
};

const addToCart = async (phone, item, businessId = 'default') => {
  const session = await getSession(phone, businessId);
  // If product already in cart, increase quantity
  const existing = session.cart.find(
    (c) => c.productId.toString() === item.productId.toString()
  );
  if (existing) {
    existing.quantity += item.quantity;
    existing.subtotal = existing.price * existing.quantity;
  } else {
    session.cart.push(item);
  }
  session.markModified('cart');
  await session.save();
  return session;
};

const clearCart = async (phone, businessId = 'default') => {
  return updateSession(phone, businessId, { cart: [] });
};

module.exports = { getSession, updateSession, resetSession, addToCart, clearCart };
