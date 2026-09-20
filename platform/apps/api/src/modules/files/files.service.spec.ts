import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { FilesService, sniffContentType } from './files.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

function makeService(maxBytes = 1000) {
  const objects = new Map<string, Buffer>();
  const rows = new Map<string, Record<string, unknown>>();
  const prisma = {
    db: {
      storedFile: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          rows.set(String(data.key), data);
          return data;
        },
        findFirst: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      },
    },
  };
  const uow = { runAsSystem: async (fn: () => Promise<unknown>) => fn() };
  const storage = {
    put: vi.fn(async (key: string, buf: Buffer) => {
      objects.set(key, buf);
    }),
    get: vi.fn(async (key: string) => objects.get(key) as Buffer),
    url: (key: string) => `/api/v1/files/${key}?exp=1&sig=s`,
    verify: vi.fn(() => true),
  };
  const config = new ConfigService({ MAX_UPLOAD_BYTES: String(maxBytes) });
  return new FilesService(prisma as never, uow as never, storage as never, config);
}

describe('FilesService', () => {
  it('sniffs content types authoritatively', () => {
    expect(sniffContentType(PNG)).toBe('image/png');
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(PDF)).toBe('application/pdf');
    expect(sniffContentType(HTML)).toBeNull();
  });

  it('accepts a real image and returns a signed URL', async () => {
    const svc = makeService();
    const res = await svc.upload('tenant-1', { buffer: PNG, size: PNG.length, originalname: 'p.png' }, 'product_image', 'u1');
    expect(res.file.contentType).toBe('image/png');
    expect(res.file.key).toMatch(/^tenant-1_\d{14}_[0-9a-f]{20}\.png$/);
    expect(res.file.url).toContain(`/api/v1/files/${res.file.key}`);
  });

  it('rejects HTML masquerading as an image (extension ignored)', async () => {
    const svc = makeService();
    await expect(
      svc.upload('tenant-1', { buffer: HTML, size: HTML.length, originalname: 'evil.jpg', mimetype: 'image/jpeg' }, 'product_image')
    ).rejects.toThrow(/Unsupported file type/);
  });

  it('rejects oversize uploads', async () => {
    const svc = makeService(10);
    await expect(svc.upload('tenant-1', { buffer: PNG, size: PNG.length })).rejects.toThrow(/too large/);
  });

  it('serves a stored file through the signed download path', async () => {
    const svc = makeService();
    const { file } = await svc.upload('tenant-1', { buffer: PNG, size: PNG.length, originalname: 'p.png' });
    const out = await svc.download(file.key, 1, 's');
    expect(out.contentType).toBe('image/png');
    expect(out.filename).toBe('p.png');
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
  });
});
