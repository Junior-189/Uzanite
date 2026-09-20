import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';

// Use a single CommonJS module instance (matching production) so the plugin's
// internal require() shares the same AsyncLocalStorage as runWithTenant().
const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const tenantScopePlugin = require('../../src/models/plugins/tenantScope.js');
const { runWithTenant } = require('../../src/context/tenantContext.js');

let mongo;
let Thing;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const schema = new mongoose.Schema({ name: String });
  schema.plugin(tenantScopePlugin);
  Thing = mongoose.model('TenantThing', schema);
}, 180000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('tenantScope plugin (DB-backed)', () => {
  it('scopes reads to the active tenant', async () => {
    await Thing.create([
      { name: 'a1', businessId: 'biz_a' },
      { name: 'b1', businessId: 'biz_b' },
    ]);

    const a = await runWithTenant({ businessId: 'biz_a', bypass: false }, async () =>
      Thing.find({}).lean()
    );
    expect(a.map((x) => x.name)).toEqual(['a1']);

    const all = await Thing.find({}).lean();
    expect(all.length).toBe(2);
  });

  it('blocks cross-tenant writes', async () => {
    await expect(
      runWithTenant({ businessId: 'biz_a', bypass: false }, async () => {
        await Thing.create({ name: 'x', businessId: 'biz_b' });
      })
    ).rejects.toThrow(/Cross-tenant/);
  });

  it('bypass context sees all tenants', async () => {
    const all = await runWithTenant({ businessId: null, bypass: true }, async () =>
      Thing.find({}).lean()
    );
    expect(all.length).toBe(2);
  });

  it('scopes countDocuments to the tenant', async () => {
    const count = await runWithTenant({ businessId: 'biz_a', bypass: false }, async () =>
      Thing.countDocuments({})
    );
    expect(count).toBe(1);
  });
});
