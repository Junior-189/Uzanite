import { PaymentAdapter } from './payment-adapter.interface';

// The always-available fallback: the tenant confirms the customer paid by
// mobile money / cash and submits a reference (and optional proof).
export const manualAdapter: PaymentAdapter = {
  name: 'manual',
  enabled: () => true,
  async initiate() {
    return {
      providerRef: null,
      status: 'pending' as const,
      instructions:
        'Ask the customer to pay the business mobile-money number, then confirm with the transaction reference.',
      raw: {},
    };
  },
  // Manual confirmations are authenticated by the app, not by a signature.
  verifySignature: () => false,
  parseWebhook: () => null,
};
