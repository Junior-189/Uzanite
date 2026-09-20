import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'zlib';
import type { Request, Response } from 'express';
import { compressionMiddleware } from './compression.middleware';

function makeRes(contentType = 'application/json; charset=utf-8') {
  const headers: Record<string, string> = { 'Content-Type': contentType };
  let sent: unknown;
  const res = {
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: unknown) => {
      headers[k] = String(v);
    },
    removeHeader: (k: string) => {
      delete headers[k];
    },
    send: (body?: unknown) => {
      sent = body;
      return res as unknown as Response;
    },
    get sent() {
      return sent;
    },
    headers,
  };
  return res;
}

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('compressionMiddleware', () => {
  it('gzip-compresses large JSON responses and sets Vary/Content-Encoding', async () => {
    const mw = compressionMiddleware();
    const req = { headers: { 'accept-encoding': 'gzip, deflate' }, method: 'GET' } as unknown as Request;
    const res = makeRes();
    mw(req, res as unknown as Response, () => {});
    const payload = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => `row-${i}`) });
    res.send(payload);
    await wait();
    expect(res.headers['Content-Encoding']).toBe('gzip');
    expect(res.headers['Vary']).toBe('Accept-Encoding');
    const out = res.sent as Buffer;
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(gunzipSync(out).toString('utf8')).toBe(payload);
  });

  it('passes small bodies through uncompressed', async () => {
    const mw = compressionMiddleware();
    const req = { headers: { 'accept-encoding': 'gzip' }, method: 'GET' } as unknown as Request;
    const res = makeRes();
    mw(req, res as unknown as Response, () => {});
    res.send('{"ok":true}');
    await wait();
    expect(res.headers['Content-Encoding']).toBeUndefined();
    expect(res.sent).toBe('{"ok":true}');
  });

  it('does not touch responses when the client does not accept gzip', async () => {
    const mw = compressionMiddleware();
    const req = { headers: {}, method: 'GET' } as unknown as Request;
    const res = makeRes();
    let nextCalled = false;
    mw(req, res as unknown as Response, () => {
      nextCalled = true;
    });
    res.send('x'.repeat(5000));
    await wait(5);
    expect(nextCalled).toBe(true);
    expect(res.headers['Content-Encoding']).toBeUndefined();
  });
});
