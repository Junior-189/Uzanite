import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { hasDb, resetDb } from './setup';
import { RetentionService } from '../src/retention.service';

const d = hasDb ? describe : describe.skip;

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

d('data retention sweep (worker, Postgres)', () => {
  let prisma: PrismaClient;
  let service: RetentionService;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    // Explicit short windows so the test does not depend on defaults.
    process.env.RETENTION_FLOW_TRACE_DAYS = '30';
    process.env.RETENTION_WEBHOOK_EVENT_DAYS = '10';
    process.env.RETENTION_LOGIN_ATTEMPT_DAYS = '30';
    process.env.RETENTION_ACTIVITY_LOG_DAYS = '0'; // disabled
    process.env.RETENTION_BATCH_SIZE = '100';
    service = new RetentionService(new ConfigService());
    await service.onApplicationBootstrap();
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function seedTenant() {
    const tenantId = randomUUID();
    await prisma.tenant.create({
      data: { id: tenantId, slug: `ret-${tenantId.slice(0, 8)}`, name: 'ret', status: 'approved' },
    });
    return tenantId;
  }

  it('removes records past their window and keeps recent ones', async () => {
    const tenantId = await seedTenant();

    await prisma.flowTrace.createMany({
      data: [
        { id: randomUUID(), tenantId, contactPhone: '255700000001', mode: 'active', input: 'old', stepFrom: 'A', stepTo: 'B', createdAt: daysAgo(90) },
        { id: randomUUID(), tenantId, contactPhone: '255700000002', mode: 'active', input: 'recent', stepFrom: 'A', stepTo: 'B', createdAt: daysAgo(5) },
      ],
    });

    const removed = await service.runOnce();

    expect(removed.flow_traces).toBe(1);
    const remaining = await prisma.flowTrace.findMany({ where: { tenantId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].input).toBe('recent');
  });

  it('honours a per-table window', async () => {
    const tenantId = await seedTenant();

    // 20 days old: past the 10-day webhook window, inside the 30-day trace one.
    await prisma.webhookEvent.create({
      data: { id: randomUUID(), tenantId, provider: 'meta', eventId: `evt-${randomUUID()}`, payload: {}, createdAt: daysAgo(20) },
    });
    await prisma.flowTrace.create({
      data: { id: randomUUID(), tenantId, contactPhone: '255700000003', mode: 'shadow', input: 'x', stepFrom: 'A', stepTo: 'B', createdAt: daysAgo(20) },
    });

    await service.runOnce();

    expect(await prisma.webhookEvent.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.flowTrace.count({ where: { tenantId } })).toBe(1);
  });

  it('does not sweep a table whose retention is disabled', async () => {
    const tenantId = await seedTenant();
    await prisma.activityLog.create({
      data: { tenantId, page: 'test', action: 'visit', createdAt: daysAgo(1000) },
    });

    const removed = await service.runOnce();

    expect(removed.activity_logs).toBeUndefined();
    expect(await prisma.activityLog.count({ where: { tenantId } })).toBe(1);
  });

  it('never touches financial records', async () => {
    const tenantId = await seedTenant();
    const orderId = randomUUID();

    await prisma.order.create({
      data: {
        id: orderId,
        tenantId,
        orderNumber: 'ORD-RET-1',
        source: 'cash',
        total: '5000',
        status: 'PAID',
        createdAt: daysAgo(3000),
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        id: randomUUID(),
        tenantId,
        type: 'cash_sale',
        direction: 'credit',
        amount: '5000',
        dedupeKey: `ret-${randomUUID()}`,
        createdAt: daysAgo(3000),
      },
    });

    await service.runOnce();

    // A business must retain these regardless of age; the ledger is also
    // append-only at the database level.
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { tenantId } })).toBe(1);
  });

  it('is safe to run twice', async () => {
    const tenantId = await seedTenant();
    await prisma.flowTrace.create({
      data: { id: randomUUID(), tenantId, contactPhone: '255700000004', mode: 'active', input: 'old', stepFrom: 'A', stepTo: 'B', createdAt: daysAgo(90) },
    });

    const first = await service.runOnce();
    const second = await service.runOnce();

    expect(first.flow_traces).toBe(1);
    expect(second.flow_traces).toBeUndefined();
  });
});
