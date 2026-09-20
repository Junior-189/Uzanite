import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { uploadFileBodySchema } from '@uzanite/contracts';
import { Public } from '../../decorators/public.decorator';
import { RequireTenant } from '../../decorators/require-tenant.decorator';
import { CurrentUser, TenantId } from '../../decorators/principal.decorator';
import { Principal } from '../../context/tenant-context';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { FilesService, UploadedFileLike } from './files.service';

// Hard cap at the multer layer; the service enforces the configured MAX_UPLOAD_BYTES.
const HARD_CAP_BYTES = 10 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function safeFilename(value: string): string {
  return String(value || 'file')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 120);
}

@ApiTags('files')
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(private readonly files: FilesService) {}

  /** Upload a private file (product image / payment proof); returns a signed URL. */
  @ApiBearerAuth()
  @RequireTenant()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HARD_CAP_BYTES } }))
  @Post()
  upload(
    @TenantId() tenantId: string,
    @CurrentUser() principal: Principal,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodValidationPipe(uploadFileBodySchema)) body: { purpose: string }
  ) {
    return this.files.upload(tenantId, file as UploadedFileLike, body?.purpose ?? 'other', principal?.userId ?? '');
  }

  /** Mint a fresh signed URL for one of the tenant's own files. */
  @ApiBearerAuth()
  @RequireTenant()
  @Get(':key/url')
  signedUrl(@TenantId() tenantId: string, @Param('key') key: string) {
    return this.files.signedUrl(tenantId, key);
  }

  /** Public download via a short-lived signed URL. */
  @Public()
  @Get(':key')
  async download(
    @Param('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response
  ): Promise<void> {
    const { buffer, contentType, filename } = await this.files.download(key, exp, sig);
    const inline = INLINE_IMAGE_TYPES.has(contentType);
    res.setHeader('Content-Type', inline ? contentType : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(buffer);
  }
}
