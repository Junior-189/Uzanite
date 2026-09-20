import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../../src/middleware/validate.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  const schema = z.object({ name: z.string().min(1), age: z.coerce.number().int().min(0) }).strict();
  app.post('/thing', validate(schema), (req, res) => res.json({ success: true, body: req.body }));
  app.use((err, req, res, next) => res.status(500).json({ success: false, error: err.message }));
  return app;
}

describe('validate middleware', () => {
  it('accepts and coerces valid input', async () => {
    const res = await request(buildApp()).post('/thing').send({ name: 'x', age: '4' });
    expect(res.status).toBe(200);
    expect(res.body.body.age).toBe(4);
  });

  it('returns 400 with details for invalid input', async () => {
    const res = await request(buildApp()).post('/thing').send({ age: -1 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('rejects unknown fields (strict)', async () => {
    const res = await request(buildApp()).post('/thing').send({ name: 'x', age: 1, role: 'admin' });
    expect(res.status).toBe(400);
  });
});
