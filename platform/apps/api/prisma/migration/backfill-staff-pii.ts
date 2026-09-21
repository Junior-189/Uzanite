/**
 * Backfill Staff PII: encrypt plaintext emails and fill `email_idx`. Idempotent.
 * Usage: DATABASE_URL=... pnpm --filter @uzanite/api migrate:pii-staff
 */
import { PrismaClient } from '@prisma/client';
import { isEncrypted } from '@uzanite/messaging';
import { blindIndex, encryptPii } from '../../src/security/pii';

const prisma = new PrismaClient();
const BATCH = 500;

async function main(): Promise<void> {
  let lastId: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.staff.findMany({
        where: lastId ? { id: { gt: lastId } } : {},
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, email: true, emailIdx: true },
      });
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned++;
      if (isEncrypted(row.email)) continue;
      const data: Record<string, unknown> = { email: encryptPii(row.email) ?? '' };
      if (!row.emailIdx) data.emailIdx = blindIndex(row.email.toLowerCase());
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.staff.update({ where: { id: row.id }, data });
      });
      updated++;
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  console.log(`Staff PII backfill complete: scanned=${scanned} updated=${updated}`);
}
main().catch((e) => { console.error('Staff PII backfill failed:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
