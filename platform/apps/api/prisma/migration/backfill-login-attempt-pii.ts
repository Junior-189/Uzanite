/**
 * Backfill LoginAttempt email: encrypt plaintext emails + fill email_idx.
 * Retained 90 days by the worker sweep; this makes older rows searchable by the
 * blind index. Idempotent.
 */
import { PrismaClient } from '@prisma/client';
import { blindIndex, encrypt, isEncrypted } from '@uzanite/messaging';

const prisma = new PrismaClient();
const BATCH = 1000;

async function main(): Promise<void> {
  let lastId = 0n;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.loginAttempt.findMany({
      where: { id: { gt: lastId } },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, email: true, emailIdx: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned++;
      if (!row.email || isEncrypted(row.email)) continue;
      await prisma.loginAttempt.update({
        where: { id: row.id },
        data: { email: encrypt(row.email), emailIdx: blindIndex(row.email.toLowerCase()) },
      });
      updated++;
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  console.log(`LoginAttempt PII backfill complete: scanned=${scanned} updated=${updated}`);
}
main().catch((e) => { console.error('LoginAttempt PII backfill failed:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
