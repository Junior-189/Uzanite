// Provider-agnostic payment adapter. Tanzanian aggregators (ClickPesa, AzamPay,
// Selcom) implement this interface; `manual` is the always-available fallback.
export type PaymentProviderName = 'manual' | 'clickpesa' | 'azampay';

export interface InitiateContext {
  tenantId: string;
  paymentId: string;
  orderId: string | null;
  amount: number;
  currency: string;
  phone: string;
  method: string;
  reference: string;
}

export interface InitiateResult {
  providerRef?: string | null;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  raw?: Record<string, unknown>;
  instructions?: string;
}

export interface ParsedWebhook {
  providerRef?: string | null;
  status?: string;
  amount?: number;
  currency?: string;
  failureReason?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentAdapter {
  readonly name: PaymentProviderName;
  /** Configured and usable in this environment. */
  enabled(): boolean;
  /** Start a payment (STK push / collection request). */
  initiate(ctx: InitiateContext): Promise<InitiateResult>;
  /** Verify a provider webhook signature against the raw request body. */
  verifySignature(rawBody: string | Buffer | undefined, headers: Record<string, unknown>): boolean;
  /** Map a provider webhook body to our canonical shape. */
  parseWebhook(body: Record<string, unknown>): ParsedWebhook | null;
}
