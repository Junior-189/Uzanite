import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { encrypt } = require('../../src/utils/crypto.js');
const WhatsAppAccount = require('../../src/models/WhatsAppAccount.js');
const metaClient = require('../../src/whatsapp/metaClient.js');

describe('metaClient', () => {
  beforeEach(() => {
    // Stub the account lookup (same module instance metaClient holds).
    WhatsAppAccount.findOne = async () => ({
      businessId: 'biz_a',
      phoneNumberId: '1234567890',
      accessTokenEnc: encrypt('TEST_TOKEN'),
      status: 'connected',
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.TEST' }] }),
    }));
  });

  it('normalizes phone numbers', () => {
    expect(metaClient.normalizeTo('255712345678@s.whatsapp.net')).toBe('255712345678');
    expect(metaClient.normalizeTo('+255 712 345 678')).toBe('255712345678');
    expect(metaClient.normalizeTo('255712345678@lid')).toBe('255712345678');
  });

  it('sends a text message with the correct payload', async () => {
    await metaClient.sendText('biz_a', '255712345678@s.whatsapp.net', 'Hello');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/1234567890/messages');
    expect(opts.headers.Authorization).toBe('Bearer TEST_TOKEN');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '255712345678', type: 'text' });
    expect(body.text.body).toBe('Hello');
  });

  it('sends a template message', async () => {
    await metaClient.sendTemplate('biz_a', '255712345678', { name: 'order_update', language: 'sw' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('order_update');
    expect(body.template.language.code).toBe('sw');
  });

  it('marks 4xx send failures as permanent (no retry)', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Bad request' } }),
    }));
    await expect(metaClient.sendText('biz_a', '255712345678', 'x')).rejects.toMatchObject({
      status: 400,
      permanent: true,
    });
  });
});
