import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createHarness, resetDb, hasDb, Harness } from './setup';
import { FilesService } from '../../src/modules/files/files.service';
import { LocalStorageService } from '../../src/storage/local-storage.service';
import { runWithRequest } from '../../src/context/tenant-context';

const d = hasDb ? describe : describe.skip;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

d('files (private upload + signed download, Postgres)', () => {
  let h: Harness;
  let storage: LocalStorageService;
  let files: FilesService;

  beforeAll(async () => {
    h = await createHarness();
    const config = new ConfigService();
    storage = new LocalStorageService(config);
    files = new FilesService(h.prisma, h.uow, storage, config);
  });
  afterAll(async () => {
    if (h) await h.prisma.onModuleDestroy();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  async function seedTenant(label: string) {
    const id = randomUUID();
    await h.prisma.base.tenant.create({
      data: { id, slug: `${label}-${id.slice(0, 8)}`, name: label, status: 'approved' },
    });
    return id;
  }

  it('stores an image, records it tenant-scoped, and serves it via a signed URL', async () => {
    const tenantId = await seedTenant('files-a');
    const res = await runWithRequest({ tenantId }, () =>
      files.upload(tenantId, { buffer: PNG, size: PNG.length, originalname: 'p.png' }, 'product_image', 'u1')
    );
    expect(res.file.contentType).toBe('image/png');

    const row = await h.prisma.base.storedFile.findUnique({ where: { key: res.file.key } });
    expect(row?.tenantId).toBe(tenantId);
    expect(row?.purpose).toBe('product_image');

    const { exp, sig } = storage.sign(res.file.key);
    const out = await files.download(res.file.key, exp, sig);
    expect(out.contentType).toBe('image/png');
    expect(out.buffer.equals(PNG)).toBe(true);
  });

  it('rejects a download with an invalid signature', async () => {
    const tenantId = await seedTenant('files-b');
    const res = await runWithRequest({ tenantId }, () =>
      files.upload(tenantId, { buffer: PNG, size: PNG.length, originalname: 'p.png' })
    );
    await expect(files.download(res.file.key, 9999999999, 'deadbeef')).rejects.toThrow(/Invalid or expired/);
  });

  it('rejects a non-image payload regardless of the declared filename', async () => {
    const tenantId = await seedTenant('files-c');
    const html = Buffer.from('<html>evil</html>');
    await expect(
      runWithRequest({ tenantId }, () =>
        files.upload(tenantId, { buffer: html, size: html.length, originalname: 'evil.png' })
      )
    ).rejects.toThrow(/Unsupported file type/);
  });
});
