import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const StoredFile = require('../../src/models/StoredFile.js');
const storage = require('../../src/services/storageService.js');

beforeAll(() => {
  // Avoid a DB: stub the metadata model.
  StoredFile.create = async (doc) => doc;
  StoredFile.deleteOne = async () => ({});
  StoredFile.findOne = () => ({ lean: async () => null });
});

describe('storageService (local private storage)', () => {
  it('stores and reads a private object', async () => {
    const key = storage.newKey('test/objects');
    await storage.putObject(key, Buffer.from('hello'), 'text/plain', { businessId: 'b1', purpose: 'test' });
    const buf = await storage.getObjectBuffer(key);
    expect(buf.toString()).toBe('hello');
    await storage.deleteObject(key);
  });

  it('signs and verifies short-lived URLs', async () => {
    const key = storage.newKey('test/objects');
    await storage.putObject(key, Buffer.from('x'), 'text/plain', {});
    const url = await storage.signedUrl(key, 60);
    expect(url).toContain('/api/files/');
    const u = new URL(url);
    expect(storage.verifyLocalSignature(key, u.searchParams.get('exp'), u.searchParams.get('sig'))).toBe(true);
    expect(storage.verifyLocalSignature(key, u.searchParams.get('exp'), 'bad-signature')).toBe(false);
    await storage.deleteObject(key);
  });

  it('resolves store: references and passes through legacy values', async () => {
    const key = storage.newKey('test/objects');
    await storage.putObject(key, Buffer.from('y'), 'text/plain', {});
    const url = await storage.resolveDisplayUrl(`store:${key}`);
    expect(url).toContain('/api/files/');
    expect(await storage.resolveDisplayUrl('uploads/legacy.jpg')).toBe('uploads/legacy.jpg');
    expect(await storage.resolveDisplayUrl(null)).toBeNull();
    await storage.deleteObject(key);
  });
});
