import { createHmac, timingSafeEqual } from 'crypto';
import { outboundRequest } from '../../../http/outbound-http';
import { InitiateContext, InitiateResult, ParsedWebhook, PaymentAdapter } from './payment-adapter.interface';

// ClickPesa (Tanzania) adapter skeleton. Enabled only when credentials are set.
// NOTE: endpoint/field names should be confirmed against the current ClickPesa
// API docs before go-live. No network call is made unless `enabled()`.
// Read at call time so the validated env (not import order) decides.
function providerTimeoutMs(): number {
  return Number(process.env.PROVIDER_TIMEOUT_MS ?? 8000);
}

function cfg() {
  return {
  clientId: process.env.CLICKPESA_CLIENT_ID ?? '',
  apiKey: process.env.CLICKPESA_API_KEY ?? '',
  baseUrl: process.env.CLICKPESA_BASE_URL ?? 'https://api.clickpesa.com',
  webhookSecret: process.env.CLICKPESA_WEBHOOK_SECRET ?? '',
};
}

function verifySignature(rawBody: string | Buffer | undefined, headers: Record<string, unknown>): boolean {
  if (!cfg().webhookSecret) return false;
  const provided = headers['x-clickpesa-signature'] ?? headers['x-signature'];
  if (!provided || !rawBody) return false;
  const expected = createHmac('sha256', cfg().webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseWebhook(body: Record<string, unknown>): ParsedWebhook | null {
  const d = (body.data as Record<string, unknown>) ?? body;
  const providerRef = d.orderReference ?? d.reference ?? d.transactionId ?? d.id;
  if (!providerRef) return null;
  return {
    providerRef: String(providerRef),
    status: String(d.status ?? d.paymentStatus ?? ''),
    amount: d.amount != null ? Number(d.amount) : undefined,
    currency: d.currency ? String(d.currency) : undefined,
    failureReason: d.message ? String(d.message) : d.failureReason ? String(d.failureReason) : undefined,
    raw: body,
  };
}

async function initiate(ctx: InitiateContext): Promise<InitiateResult> {
  // retries: 0 — initiating a collection is NOT idempotent on the provider
  // side; a retry can charge the customer twice.
  const res = await outboundRequest<Record<string, unknown>>('clickpesa', 'initiate', {
    url: `${cfg().baseUrl.replace(/\/$/, '')}/third-parties/payments/initiate`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': cfg().clientId,
      Authorization: `Bearer ${cfg().apiKey}`,
    },
    body: {
      amount: String(ctx.amount),
      currency: ctx.currency,
      phoneNumber: ctx.phone.replace(/\D/g, ''),
      orderReference: ctx.reference,
      paymentMethod: ctx.method || 'mobile',
    },
    timeoutMs: providerTimeoutMs(),
    retries: 0,
  });
  const json = res.json;
  if (!res.ok) throw new Error(String(json.message ?? `ClickPesa initiate failed (${res.status})`));
  return {
    providerRef: String(json.orderReference ?? json.reference ?? ctx.reference),
    status: 'pending',
    raw: json,
  };
}

export const clickpesaAdapter: PaymentAdapter = {
  name: 'clickpesa',
  enabled: () => !!(cfg().clientId && cfg().apiKey),
  initiate,
  verifySignature,
  parseWebhook,
};
