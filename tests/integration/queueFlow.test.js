import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { encrypt } = require('../../src/utils/crypto.js');
const WhatsAppAccount = require('../../src/models/WhatsAppAccount.js');
const ChatMessage = require('../../src/models/ChatMessage.js');
const { registerLocalProcessors } = require('../../src/queue/worker.js');
const { enqueue } = require('../../src/queue/queues.js');

let mongo;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  registerLocalProcessors();
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ messages: [{ id: 'wamid.Q1' }] }),
  }));
});

describe('queue -> Meta Cloud API flow (DB-backed)', () => {
  it('delivers a queued WhatsApp text and correlates the provider id', async () => {
    await WhatsAppAccount.create({
      businessId: 'biz_q',
      phoneNumberId: '999',
      accessTokenEnc: encrypt('TOK'),
      status: 'connected',
    });
    await ChatMessage.create({
      businessId: 'biz_q',
      contactPhone: '255700000000',
      direction: 'outbound',
      text: 'hi',
      providerMessageId: '',
    });

    await enqueue('whatsapp-outbound', 'text', {
      businessId: 'biz_q',
      to: '255700000000',
      text: 'Hello from the queue',
    });
    await wait(250);

    expect(global.fetch).toHaveBeenCalled();
    const msg = await ChatMessage.findOne({ businessId: 'biz_q', direction: 'outbound' });
    expect(msg.providerMessageId).toBe('wamid.Q1');
    expect(msg.status).toBe('sent');
  });

  it('fans out a broadcast into per-recipient outbound jobs', async () => {
    global.fetch.mockClear();
    await WhatsAppAccount.create({
      businessId: 'biz_bc',
      phoneNumberId: '1000',
      accessTokenEnc: encrypt('TOK'),
      status: 'connected',
    });

    await enqueue('broadcast', 'send', {
      businessId: 'biz_bc',
      channel: 'whatsapp',
      message: 'Sale!',
      contacts: [{ phone: '255700000001' }, { phone: '255700000002' }],
      emailContacts: [],
    });
    await wait(400);

    expect(global.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
