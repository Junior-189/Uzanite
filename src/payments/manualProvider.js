// Manual provider: the always-available fallback. The tenant confirms the
// customer paid by mobile money and submits a reference (and optional proof).
module.exports = {
  name: 'manual',
  enabled: () => true,
  async initiate() {
    return {
      providerRef: null,
      status: 'pending',
      instructions: 'Ask the customer to pay the business mobile-money number, then confirm with the transaction reference.',
      raw: {},
    };
  },
  verifySignature: () => false,
  parseWebhook: () => null,
};
