import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { AdminPrivacyController } from '../../src/modules/admin/admin-privacy.controller';
import { AdminQueuesController } from '../../src/modules/admin/admin-queues.controller';
import { QueueService } from '../../src/queue/queue.service';

const d = hasDb ? describe : describe.skip;

d('admin ops: privacy + queues (Postgres)', () => {
  let h: Harness;
  let privacy: AdminPrivacyController;
  let queuesAdmin: AdminQueuesController;
  let queue: QueueService;

  beforeAll(async () => {
    h = await createHarness();
    privacy = new AdminPrivacyController(new PrivacyService(h.prisma), h.prisma);
    queue = new QueueService(h.config);
    queuesAdmin = new AdminQueuesController(queue);
  });
  afterAll(async () => {
    await queue.onModuleDestroy();
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  const admin = () => ({ userId: randomUUID(), platformRole: 'super_admin', role: null } as never);
  const req = () => ({ ip: '127.0.0.1', headers: {} } as never);

  async function seedTenant(label: string) {
    const id = randomUUID();
    await h.prisma.base.tenant.create({ data: { id, slug: `${label}-${id.slice(0, 8)}`, name: label, status: 'approved' } });
    return id;
  }

  it('exports a tenant via the admin privacy endpoint', async () => {
    const t = await seedTenant('priv');
    await h.prisma.base.whatsAppContact.create({ data: { id: randomUUID(), tenantId: t, phone: '255700000001', name: 'Asha' } });

    const res = await privacy.exportTenant(admin(), t, req());
    expect(res).toBeTruthy();
    expect(res.success).toBe(true);
  });

  it('refuses tenant-wide erasure with actionable guidance', async () => {
    await seedTenant('priv-erase');
    expect(() => privacy.eraseTenant(admin())).toThrow(/not supported/i);
  });

  it('reports queue stats and dead letters', async () => {
    await queue.add('email', 'smoke', { hello: 'world' });
    const stats = await queuesAdmin.stats(admin());
    expect(stats.success).toBe(true);
    expect(stats.redis).toBe(true);
    expect(stats.queues).toHaveProperty('email');

    const dead = await queuesAdmin.deadLetters(admin());
    expect(dead.success).toBe(true);
    expect(Array.isArray(dead.items)).toBe(true);
  });
});
