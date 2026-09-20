import { describe, it, expect, beforeEach, vi } from 'vitest';

// The module reads env + storage at import time, so it is imported fresh per
// test file and axios is mocked at the adapter level rather than stubbing fetch.
vi.mock('../context/LangContext', () => ({ getT: () => (k) => k }));
vi.mock('./translateApiMessage', () => ({ translateApiMessage: (m) => m }));

import api from './api';
import { clearSession, getAccessToken, saveSession } from './tokenStore';

/**
 * Behaviour that matters on Tanzanian mobile networks:
 *  - idempotent reads retry instead of failing on a transient stall;
 *  - writes NEVER retry, because a duplicated order costs real money;
 *  - a 429 surfaces the server's Retry-After instead of hot-looping.
 */
describe('api client', () => {
  beforeEach(() => {
    clearSession();
    api.defaults.adapter = undefined;
  });

  function adapter(handler) {
    api.defaults.adapter = async (config) => handler(config);
  }

  it('attaches the in-memory access token', async () => {
    saveSession({ token: 'tok-1', refreshToken: 'r' });
    let seen = null;
    adapter(async (config) => {
      seen = config.headers.Authorization;
      return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
    });

    await api.get('/anything');
    expect(seen).toBe('Bearer tok-1');
    expect(getAccessToken()).toBe('tok-1');
  });

  it('retries an idempotent read after a transport failure', async () => {
    let calls = 0;
    adapter(async (config) => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('Network Error');
        err.config = config;
        err.request = {};
        throw err;
      }
      return { data: { success: true, calls }, status: 200, statusText: 'OK', headers: {}, config };
    });

    const res = await api.get('/products');
    expect(res.success).toBe(true);
    expect(calls).toBe(3);
  });

  it('does not retry a write', async () => {
    let calls = 0;
    adapter(async (config) => {
      calls += 1;
      const err = new Error('Network Error');
      err.config = config;
      err.request = {};
      throw err;
    });

    // A retried POST could duplicate an order or a payment.
    await expect(api.post('/orders', { items: [] })).rejects.toMatchObject({ error: 'network' });
    expect(calls).toBe(1);
  });

  it('gives up after the read retry budget', async () => {
    let calls = 0;
    adapter(async (config) => {
      calls += 1;
      const err = new Error('Network Error');
      err.config = config;
      err.request = {};
      throw err;
    });

    await expect(api.get('/products')).rejects.toMatchObject({ error: 'network' });
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('surfaces Retry-After on a 429 instead of retrying', async () => {
    let calls = 0;
    adapter(async (config) => {
      calls += 1;
      const err = new Error('Too Many Requests');
      err.config = config;
      err.response = {
        status: 429,
        data: { error: 'Too many requests.' },
        headers: { 'retry-after': '42' },
        config,
      };
      throw err;
    });

    await expect(api.get('/orders')).rejects.toMatchObject({ error: 'rate_limited', retryAfter: 42 });
    expect(calls).toBe(1);
  });

  it('reports offline distinctly so callers can queue the write', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    adapter(async (config) => {
      const err = new Error('Network Error');
      err.config = config;
      err.request = {};
      throw err;
    });

    await expect(api.post('/orders', {})).rejects.toMatchObject({ error: 'offline', offline: true });
  });

  it('unwraps the response envelope', async () => {
    adapter(async (config) => ({
      data: { success: true, orders: [1, 2] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }));

    const res = await api.get('/orders');
    expect(res.orders).toEqual([1, 2]);
  });
});
