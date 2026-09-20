import { decrypt } from './crypto';

export interface MetaCredentials {
  phoneNumberId: string;
  accessToken: string;
}

export interface MetaSendResult {
  messageId: string | null;
  raw: unknown;
}

export interface MetaTemplateRef {
  name: string;
  language?: string;
  components?: unknown[];
}

export interface MetaMediaRef {
  type?: 'image' | 'document' | 'audio' | 'video';
  link?: string;
  id?: string;
  caption?: string;
  filename?: string;
}

export interface InteractiveButton {
  id: string;
  title: string;
}
export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}
export interface InteractiveListSection {
  title: string;
  rows: InteractiveListRow[];
}
export interface InteractiveButtonsInput {
  body: string;
  buttons: InteractiveButton[];
  footer?: string;
}
export interface InteractiveListInput {
  body: string;
  buttonText: string;
  sections: InteractiveListSection[];
  footer?: string;
}

// Canonical interactive reply stored on the outbound `messages.raw` column.
export type InteractiveReply =
  | { kind: 'buttons'; body: string; buttons: InteractiveButton[]; footer?: string }
  | { kind: 'list'; body: string; buttonText: string; sections: InteractiveListSection[]; footer?: string };

export class MetaApiError extends Error {
  readonly status?: number;
  readonly permanent: boolean;
  readonly meta?: unknown;
  constructor(message: string, opts: { status?: number; permanent: boolean; meta?: unknown }) {
    super(message);
    this.name = 'MetaApiError';
    this.status = opts.status;
    this.permanent = opts.permanent;
    this.meta = opts.meta;
  }
}

export interface MetaClientOptions {
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Normalize a recipient to Meta's expected digits-only MSISDN.
export function normalizeRecipient(to: string): string {
  return String(to ?? '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@lid$/i, '')
    .replace(/\D/g, '');
}

/**
 * Thin, dependency-free Meta WhatsApp Cloud API client. Only Meta Cloud API is
 * used (no Baileys). `fetchImpl` is injectable for tests.
 */
export class MetaClient {
  constructor(private readonly opts: MetaClientOptions = {}) {}

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  private get graph(): string {
    const version = this.opts.graphVersion ?? process.env.META_GRAPH_VERSION ?? 'v21.0';
    return `https://graph.facebook.com/${version}`;
  }

  private async request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const error = (json as { error?: { message?: string } }).error;
        throw new MetaApiError(error?.message ?? `Meta request failed (${res.status})`, {
          status: res.status,
          // 4xx (except 429) are permanent — do not retry.
          permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
          meta: error,
        });
      }
      return json;
    } catch (err) {
      if (err instanceof MetaApiError) throw err;
      // Network error / timeout — transient.
      throw new MetaApiError((err as Error).message || 'Meta request error', { permanent: false });
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  }

  async postMessage(creds: MetaCredentials, body: Record<string, unknown>): Promise<MetaSendResult> {
    if (!creds.phoneNumberId) throw new MetaApiError('WhatsApp account has no phone_number_id', { permanent: true });
    if (!creds.accessToken) throw new MetaApiError('WhatsApp account has no access token', { permanent: true });
    const json = await this.request(`${this.graph}/${creds.phoneNumberId}/messages`, {
      method: 'POST',
      headers: this.headers(creds.accessToken),
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const messages = json.messages as Array<{ id?: string }> | undefined;
    return { messageId: messages?.[0]?.id ?? null, raw: json };
  }

  sendText(creds: MetaCredentials, to: string, text: string): Promise<MetaSendResult> {
    return this.postMessage(creds, {
      to: normalizeRecipient(to),
      type: 'text',
      text: { preview_url: false, body: String(text).slice(0, 4096) },
    });
  }

  sendTemplate(creds: MetaCredentials, to: string, template: MetaTemplateRef): Promise<MetaSendResult> {
    if (!template.name) throw new MetaApiError('Template name is required', { permanent: true });
    return this.postMessage(creds, {
      to: normalizeRecipient(to),
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language ?? 'en_US' },
        components: template.components ?? [],
      },
    });
  }

  sendMedia(creds: MetaCredentials, to: string, media: MetaMediaRef): Promise<MetaSendResult> {
    const type = media.type ?? 'image';
    if (!media.link && !media.id) throw new MetaApiError('Media link or id is required', { permanent: true });
    const payload: Record<string, unknown> = {};
    if (media.id) payload.id = media.id;
    if (media.link) payload.link = media.link;
    if (media.caption && (type === 'image' || type === 'document')) payload.caption = media.caption;
    if (media.filename && type === 'document') payload.filename = media.filename;
    return this.postMessage(creds, { to: normalizeRecipient(to), type, [type]: payload });
  }

  // Native interactive buttons (max 3; title <= 20 chars).
  sendInteractiveButtons(creds: MetaCredentials, to: string, input: InteractiveButtonsInput): Promise<MetaSendResult> {
    return this.postMessage(creds, {
      to: normalizeRecipient(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: input.body },
        action: {
          buttons: input.buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
      },
    });
  }

  // Native interactive list (max 10 sections / 10 rows; titles truncated).
  sendInteractiveList(creds: MetaCredentials, to: string, input: InteractiveListInput): Promise<MetaSendResult> {
    return this.postMessage(creds, {
      to: normalizeRecipient(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: input.body },
        action: {
          button: input.buttonText.slice(0, 20),
          sections: input.sections.slice(0, 10).map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          })),
        },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
      },
    });
  }

  // Dispatch a canonical InteractiveReply to the right interactive endpoint.
  sendInteractive(creds: MetaCredentials, to: string, reply: InteractiveReply): Promise<MetaSendResult> {
    return reply.kind === 'buttons'
      ? this.sendInteractiveButtons(creds, to, { body: reply.body, buttons: reply.buttons, footer: reply.footer })
      : this.sendInteractiveList(creds, to, { body: reply.body, buttonText: reply.buttonText, sections: reply.sections, footer: reply.footer });
  }

  async uploadMedia(creds: MetaCredentials, buffer: Buffer, mimeType: string, filename = 'file'): Promise<string> {
    if (!creds.phoneNumberId) throw new MetaApiError('WhatsApp account has no phone_number_id', { permanent: true });
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    const res = await this.fetchImpl(`${this.graph}/${creds.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !json.id) {
      throw new MetaApiError(json.error?.message ?? `Meta media upload failed (${res.status})`, {
        status: res.status,
        permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
      });
    }
    return json.id;
  }

  async markRead(creds: MetaCredentials, messageId: string): Promise<void> {
    await this.postMessage(creds, { status: 'read', message_id: messageId });
  }

  static decryptToken(enc: string): string {
    return decrypt(enc);
  }
}

// ── Meta webhook payload (loose; Meta's schema evolves) ──────────────────────
export interface MetaWebhookMessage {
  id: string;
  from: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}

export interface MetaWebhookStatus {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export interface MetaWebhookValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

export interface MetaWebhookBody {
  object?: string;
  entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: MetaWebhookValue }> }>;
}

export function extractInboundText(message: MetaWebhookMessage): string {
  return (
    message.text?.body ??
    message.image?.caption ??
    message.document?.caption ??
    message.video?.caption ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    ''
  );
}

/**
 * The effective flow input: for interactive replies this is the button/list row
 * **id** (the command token), otherwise the text body.
 */
export function extractInboundInput(message: MetaWebhookMessage): string {
  return (
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    extractInboundText(message)
  );
}
