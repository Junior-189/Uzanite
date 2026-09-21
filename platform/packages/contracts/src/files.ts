import { z } from 'zod';

export const filePurpose = z.enum(['product_image', 'payment_proof', 'other']);

// Multipart form fields arrive as strings; only `purpose` is structured.
export const uploadFileBodySchema = z
  .object({
    purpose: filePurpose.optional().default('other'),
  })
  .strict();

export type FilePurpose = z.infer<typeof filePurpose>;
export type UploadFileBody = z.infer<typeof uploadFileBodySchema>;
