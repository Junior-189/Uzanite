import { createHmac, timingSafeEqual } from 'crypto';
import { outboundRequest } from '../../../http/outbound-http';
import { InitiateContext, InitiateResult, ParsedWebhook, PaymentAdapter } from './payment-adapter.interface';

// AzamPay (Tanzania) adapter skeleton. Enabled only when credentials are set.
// NOTE: endpoint/field names should be confirmed against the current AzamPay API
// docs before go-live. No network call is made unless `enabled()`.
function providerTimeoutMs(): number {
  return Number(process.env.PROVIDER_TIMEOUT_MS ?? 8000);
}

const cfg = {
  appName: process.env.AZAMPAY_APP_NAME ?? '',
  clientId: process.env.AZAMPAY_CLIENT_ID ?? '',
  clientSecret: process.env.AZAMPAY_CLIENT_SECRET ?? '',
  baseUrl: process.env.AZAMPAY_BASE_URL ?? 'https://sandbox.azampay.co.tz',
  webhookSecret: process.env.AZAMPAY_WEBHOOK_SECRET ?? '',
};

function verifySignature(rawBody: string | Buffer | undefined, headers: Record<string, unknown>): boolean {
  if (!cfg.webhookSecret) return false;
  const provided = headers['x-azampay-signature'] ?? headers['x-signature'];
  if (!provided || !rawBody) return false;
  const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseWebhook(body: Record<string, unknown>): ParsedWebhook | null {
  const d = (body.data as Record<string, unknown>) ?? body;
  const providerRef = d.externalId ?? d.reference ?? d.transactionId ?? d.id;
  if (!providerRef) return null;
  return {
    providerRef: String(providerRef),
    status: String(d.status ?? d.transactionStatus ?? ''),
    amount: d.amount != null ? Number(d.amount) : undefined,
    currency: d.currency ? String(d.currency) : undefined,
    failureReason: d.message ? String(d.message) : undefined,
    raw: body,
  };
}

async function getToken(): Promise<string> {
  // Auth is idempotent, so a single retry is safe and saves a failed payment.
  const res = await outboundRequest<{ data?: { accessToken?: string }; message?: string }>('azampay', 'auth', {
    url: `${cfg.baseUrl.replace(/\/$/, '')}/AppRegistration/GenerateToken`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { appName: cfg.appName, clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    timeoutMs: providerTimeoutMs(),
    retries: 1,
  });
  const json = res.json;
  if (!res.ok || !json.data?.accessToken) throw new Error(String(json.message ?? `AzamPay auth failed (${res.status})`));
  return json.data.accessToken;
}

async function initiate(ctx: InitiateContext): Promise<InitiateResult> {
  const token = await getToken();
  // retries: 0 — a checkout is not idempotent provider-side.
  const res = await outboundRequest<Record<string, unknown>>('azampay', 'initiate', {
    url: `${cfg.baseUrl.replace(/\/$/, '')}/azampay/mno/checkout`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: {
      accountNumber: ctx.phone.replace(/\D/g, ''),
      amount: String(ctx.amount),
      currency: ctx.currency,
      externalId: ctx.reference,
      provider: ctx.method || 'Mpesa',
    },
    timeoutMs: providerTimeoutMs(),
    retries: 0,
  });
  const json = res.json;
  if (!res.ok) throw new Error(String(json.message ?? `AzamPay initiate failed (${res.status})`));
  return {
    providerRef: String(json.transactionId ?? json.reference ?? ctx.reference),
    status: 'pending',
    raw: json,
  };
}

export const azampayAdapter: PaymentAdapter = {
  name: 'azampay',
  enabled: () => !!(cfg.appName && cfg.clientId && cfg.clientSecret),
  initiate,
  verifySignature,
  parseWebhook,
};
