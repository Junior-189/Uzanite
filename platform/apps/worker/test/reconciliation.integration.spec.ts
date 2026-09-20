import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { hasDb, resetDb } from './setup';
import { ReconciliationService } from '../src/reconciliation.service';
import { NotificationWriter } from '../src/consumers/notification-writer.service';

const d = hasDb ? describe : describe.skip;

d('ledger reconciliation (worker, Postgres)', () => {
  let prisma: PrismaClient;
  let service: ReconciliationService;

  beforeAll(() => {
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    service = new ReconciliationService(new ConfigService(), new NotificationWriter());
  });
  afterAll(async () => {
    await service.onApplicationShutdown();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function seedTenant(label: string) {
    const tenantId = randomUUID();
    await prisma.tenant.create({ data: { id: tenantId, slug: `${label}-${tenantId.slice(0, 8)}`, name: label, status: 'approved' } });
    return tenantId;
  }

  async function seedJournal(tenantId: string, debit: string, credit: string) {
    const journalId = randomUUID();
    await prisma.journalEntry.create({
      data: { id: journalId, tenantId, refType: 'probe', refId: journalId, dedupeKey: `probe-${journalId}` },
    });
    await prisma.journalLine.createMany({
      data: [
        { id: randomUUID(), tenantId, journalId, account: 'cash', direction: 'debit', amount: debit, currency: 'TZS' },
        { id: randomUUID(), tenantId, journalId, account: 'revenue', direction: 'credit', amount: credit, currency: 'TZS' },
      ],
    });
  }

  it('detects unbalanced journals and raises one alert per tenant per day', async () => {
    const tenantId = await seedTenant('recon-a');
    await seedJournal(tenantId, '100', '90');

    const res = await service.runOnce();
    expect(res.unbalancedTenants).toBe(1);
    expect(res.unbalancedJournals).toBe(1);
    expect(await prisma.notification.count({ where: { tenantId, type: 'ledger_unbalanced' } })).toBe(1);

    // Re-running the same day does not duplicate the alert (dedupe key).
    await service.runOnce();
    expect(await prisma.notification.count({ where: { tenantId, type: 'ledger_unbalanced' } })).toBe(1);
  });

  it('reports balanced when all journals balance', async () => {
    const tenantId = await seedTenant('recon-b');
    await seedJournal(tenantId, '250', '250');

    const res = await service.runOnce();
    expect(res.unbalancedTenants).toBe(0);
    expect(await prisma.notification.count({ where: { tenantId, type: 'ledger_unbalanced' } })).toBe(0);
  });
});
