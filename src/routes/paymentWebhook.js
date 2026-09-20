// Provider payment webhooks. Signature-verified and idempotent; processing is
// enqueued so the HTTP response is fast and retries/DLQ are handled.
const express = require('express');
const router = express.Router();
const { getProvider } = require('../payments');
const logger = require('../config/logger');

router.post('/:provider', async (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider || provider.name === 'manual' || !provider.enabled()) {
    return res.sendStatus(404);
  }
  if (!provider.verifySignature(req.rawBody, req.headers)) {
    logger.warn({ provider: provider.name }, 'Rejected payment webhook with invalid signature');
    return res.sendStatus(401);
  }

  // Acknowledge immediately; process asynchronously.
  res.sendStatus(200);
  try {
    const parsed = provider.parseWebhook(req.body || {});
    if (parsed && parsed.providerRef) {
      const { enqueue } = require('../queue/queues');
      await enqueue('payments', 'apply', { providerName: provider.name, ...parsed });
    } else {
      logger.warn({ provider: provider.name }, 'Payment webhook missing providerRef');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Payment webhook processing error');
  }
});

module.exports = router;
