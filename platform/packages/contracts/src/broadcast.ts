import { z } from 'zod';

// Mirrors the legacy Express broadcast schemas.
export const broadcastSendSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    subject: z.string().trim().max(200).optional(),
    channel: z.enum(['whatsapp', 'email', 'both']).optional().default('whatsapp'),
  })
  .strict();

export const broadcastContactSchema = z
  .object({
    email: z.string().trim().min(3).max(200),
    name: z.string().trim().max(120).optional().default(''),
  })
  .strict();

export const broadcastImportSchema = z
  .object({
    data: z.union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())]),
  })
  .strict();

export type BroadcastSendInput = z.infer<typeof broadcastSendSchema>;
export type BroadcastContactInput = z.infer<typeof broadcastContactSchema>;
export type BroadcastImportInput = z.infer<typeof broadcastImportSchema>;
