/**
 * Backfill Message PII: encrypt contact_phone/text and fill contact_phone_idx.
 * Idempotent. Usage: DATABASE_URL=... pnpm --filter @uzanite/api migrate:pii-messages
 */
import { PrismaClient } from '@prisma/client';
import { blindIndex, encrypt, isEncrypted } from '@uzanite/messaging';

const prisma = new PrismaClient();
const BATCH = 500;

async function main(): Promise<void> {
  let lastId: string | null = null;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return tx.message.findMany({
        where: lastId ? { id: { gt: lastId } } : {},
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, contactPhone: true, contactPhoneIdx: true, text: true },
      });
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      scanned++;
      const phonePlain = isEncrypted(row.contactPhone) ? null : row.contactPhone;
      const data: Record<string, unknown> = {};
      if (phonePlain && phonePlain !== '') {
        data.contactPhone = encrypt(phonePlain);
        if (!row.contactPhoneIdx) data.contactPhoneIdx = blindIndex(phonePlain);
      }
      if (row.text && !isEncrypted(row.text)) data.text = encrypt(row.text);
      if (Object.keys(data).length > 0) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.message.update({ where: { id: row.id }, data });
        });
        updated++;
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  console.log(`Message PII backfill complete: scanned=${scanned} updated=${updated}`);
}
main().catch((e) => { console.error('Message PII backfill failed:', e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
