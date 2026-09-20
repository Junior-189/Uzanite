import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWorkService } from '../../prisma/unit-of-work.service';
import { LocalStorageService } from '../../storage/local-storage.service';
import { newId } from '../../ids/id';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

// Content sniffing is authoritative — the client-declared MIME type is ignored,
// so a `.jpg` carrying HTML/SVG can never be stored as an image.
export function sniffContentType(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  const head6 = buffer.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

export interface UploadedFileLike {
  buffer: Buffer;
  size: number;
  originalname?: string;
  mimetype?: string;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWorkService,
    private readonly storage: LocalStorageService,
    private readonly config: ConfigService
  ) {}

  async upload(tenantId: string, file: UploadedFileLike, purpose = 'other', actor = '') {
    const max = this.config.get<number>('MAX_UPLOAD_BYTES') ?? 5 * 1024 * 1024;
    if (!file?.buffer?.length) throw new BadRequestException('No file provided');
    if (file.size > max) throw new BadRequestException(`File too large (max ${max} bytes)`);

    const contentType = sniffContentType(file.buffer);
    if (!contentType) throw new BadRequestException('Unsupported file type (allowed: jpeg, png, gif, webp, pdf)');

    const key = LocalStorageService.newKey(tenantId, EXT[contentType]);
    await this.storage.put(key, file.buffer);

    const record = await this.prisma.db.storedFile.create({
      data: {
        id: newId(),
        tenantId,
        key,
        originalName: file.originalname || key,
        contentType,
        size: file.size,
        purpose,
        recordedBy: actor,
      },
    });

    return {
      success: true,
      file: {
        id: record.id,
        key,
        url: this.storage.url(key),
        contentType,
        size: file.size,
        originalName: record.originalName,
      },
    };
  }

  async download(key: string, exp: unknown, sig: unknown): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    if (!this.storage.verify(key, Number(exp), String(sig ?? ''))) {
      throw new ForbiddenException('Invalid or expired link');
    }
    // Signed-URL reads happen with no tenant context; use a system transaction so
    // RLS is bypassed deliberately and the lookup is by globally-unique key.
    const meta = await this.uow.runAsSystem(() =>
      this.prisma.db.storedFile.findFirst({ where: { key, deletedAt: null } })
    );
    if (!meta) throw new NotFoundException('File not found');
    const buffer = await this.storage.get(key);
    return { buffer, contentType: meta.contentType, filename: meta.originalName };
  }
}
