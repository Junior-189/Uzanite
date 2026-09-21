/**
 * Backfill WhatsAppContact PII for the blind-index rollout.
 *
 * Encrypts plaintext `phone` / `name` / `email`, fills `phone_idx`, and leaves
 * already-encrypted values untouched. Idempotent.
 *
 * Usage: DATABASE_URL=... pnpm --filter @uzanite/api migrate:pii-contacts
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
      return tx.whatsAppContact.findMany({
        where: lastId ? { id: { gt: lastId } } : {},
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, phone: true, phoneIdx: true, name: true, email: true },
      });
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const phonePlain = isEncrypted(row.phone) ? null : row.phone;
      const data: Record<string, unknown> = {};
      if (phonePlain && phonePlain !== '') {
        data.phone = encryptPii(phonePlain);
        if (!row.phoneIdx) data.phoneIdx = blindIndex(phonePlain);
      }
      if (row.name && !isEncrypted(row.name)) data.name = encryptPii(row.name);
      if (row.email && !isEncrypted(row.email)) data.email = encryptPii(row.email);

      if (Object.keys(data).length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.whatsAppContact.update({ where: { id: row.id }, data });
        });
        updated++;
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }

  console.log(`Contact PII backfill complete: scanned=${scanned} updated=${updated}`);
}

main()
  .catch((err) => {
    console.error('Contact PII backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
