// MongoDB transaction helper.
//
// Requires a replica set (MongoDB Atlas provides one). For single-node local
// development, set DISABLE_TRANSACTIONS=true to skip sessions, or the helper
// will transparently fall back when the server reports transactions are
// unsupported.
const mongoose = require('mongoose');
const logger = require('../config/logger');

async function withTransaction(fn) {
  if (process.env.DISABLE_TRANSACTIONS === 'true') {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (/Transaction numbers are only allowed|replica set|mongos/i.test(err.message || '')) {
      logger.warn('Transactions unsupported by MongoDB deployment; executing without a session');
      return fn(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction };
