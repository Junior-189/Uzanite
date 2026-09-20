const { applyResult } = require('../services/paymentService');

// Applies provider payment results idempotently.
module.exports = { payments: { apply: async (data) => applyResult(data) } };
