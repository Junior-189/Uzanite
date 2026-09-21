/**
 * Backfill Order PII for the blind-index rollout.
 *
 * Existing rows may hold plaintext `customer_name` / `customer_phone` and a
 * NULL `customer_phone_idx`. This encrypts the plaintext values and populates
 * the index so equality lookups work. Idempotent: already-encrypted values are
 * left untouched (the index is still (re)computed).
 *
 * Usage: DATABASE_URL=... pnpm --filter @uzanite/api migrate:pii-orders
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
      return tx.order.findMany({
        where: lastId ? { id: { gt: lastId } } : {},
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, customerName: true, customerPhone: true, customerPhoneIdx: true },
      });
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const phonePlain = isEncrypted(row.customerPhone) ? null : row.customerPhone;
      const namePlain = isEncrypted(row.customerName) ? null : row.customerName;
      const idx = row.customerPhoneIdx ?? (phonePlain || row.customerPhone ? blindIndex(phonePlain ?? '') : null);

      const data: Record<string, unknown> = {};
      if (phonePlain && phonePlain !== '') data.customerPhone = encryptPii(phonePlain);
      if (namePlain) data.customerName = encryptPii(namePlain);
      if (!row.customerPhoneIdx && phonePlain) data.customerPhoneIdx = idx;

      if (Object.keys(data).length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.order.update({ where: { id: row.id }, data });
        });
        updated++;
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }

  console.log(`Order PII backfill complete: scanned=${scanned} updated=${updated}`);
}

main()
  .catch((err) => {
    console.error('Order PII backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
