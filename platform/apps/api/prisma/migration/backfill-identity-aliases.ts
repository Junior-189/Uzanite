/* eslint-disable no-console */
/**
 * Backfill `identity_aliases` from the denormalised `legacy_id` / `slug`
 * columns for databases migrated BEFORE migration 0007_identity_aliases.
 *
 *   DATABASE_URL=... pnpm migrate:aliases
 *
 * Idempotent: aliases are upserted on (provider, kind, external_id).
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const counts = { user: 0, staff: 0, tenant: 0 };

  const users = await prisma.user.findMany({
    where: { legacyId: { not: null } },
    select: { id: true, legacyId: true },
  });
  for (const u of users) {
    const legacy = String(u.legacyId);
    const isStaff = legacy.startsWith('staff:');
    const kind = isStaff ? 'staff' : 'user';
    const externalId = isStaff ? legacy.slice('staff:'.length) : legacy;
    await prisma.identityAlias.upsert({
      where: { provider_kind_externalId: { provider: 'legacy_mongo', kind, externalId } },
      update: { userId: u.id },
      create: { id: randomUUID(), provider: 'legacy_mongo', kind, externalId, userId: u.id, note: 'backfill-identity-aliases' },
    });
    counts[kind as 'user' | 'staff']++;
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, legacyId: true } });
  for (const t of tenants) {
    const externalIds = new Set<string>([t.slug]);
    if (t.legacyId) externalIds.add(t.legacyId);
    for (const externalId of externalIds) {
      await prisma.identityAlias.upsert({
        where: { provider_kind_externalId: { provider: 'legacy_mongo', kind: 'tenant', externalId } },
        update: { tenantId: t.id },
        create: { id: randomUUID(), provider: 'legacy_mongo', kind: 'tenant', externalId, tenantId: t.id, note: 'backfill-identity-aliases' },
      });
      counts.tenant++;
    }
  }

  console.log('Identity alias backfill complete:', JSON.stringify(counts));
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
