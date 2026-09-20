import { z } from 'zod';
import { uuid } from './common';

export const whatsappAccountStatus = z.enum(['pending', 'connected', 'disconnected', 'error']);
export const whatsappFlowMode = z.enum(['off', 'shadow', 'active']);
export const messageDirection = z.enum(['inbound', 'outbound']);
export const messageStatus = z.enum(['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received']);

// Access/verify tokens are write-only: accepted on upsert, never returned.
export const upsertWhatsAppAccountSchema = z
  .object({
    phoneNumberId: z.string().trim().min(1).max(64),
    wabaId: z.string().trim().max(64).optional().default(''),
    displayPhoneNumber: z.string().trim().max(32).optional().default(''),
    accessToken: z.string().trim().min(1).max(4096).optional(),
    verifyToken: z.string().trim().max(256).optional(),
    // Conversation-flow rollout mode (M8): off = Express, shadow = compute only,
    // active = NestJS replies.
    flowMode: whatsappFlowMode.optional(),
    // When true the NestJS flow records messages but does not auto-reply.
    botPaused: z.boolean().optional(),
  })
  .strict();

export const listFlowTracesQuery = z
  .object({
    contactPhone: z.string().trim().max(32).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const upsertWhatsAppTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    language: z.string().trim().min(2).max(20).optional().default('en_US'),
    category: z.string().trim().max(40).optional().default(''),
    status: z.string().trim().max(40).optional().default(''),
    components: z.array(z.unknown()).optional().default([]),
  })
  .strict();

export const sendTextMessageSchema = z
  .object({
    to: z.string().trim().min(5).max(32),
    text: z.string().trim().min(1).max(4096),
    idempotencyKey: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const sendTemplateMessageSchema = z
  .object({
    to: z.string().trim().min(5).max(32),
    templateName: z.string().trim().min(1).max(120),
    language: z.string().trim().min(2).max(20).optional().default('en_US'),
    components: z.array(z.unknown()).optional().default([]),
    idempotencyKey: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const sendMediaMessageSchema = z
  .object({
    to: z.string().trim().min(5).max(32),
    type: z.enum(['image', 'document', 'audio', 'video']).optional().default('image'),
    link: z.string().url().optional(),
    mediaId: z.string().trim().max(256).optional(),
    caption: z.string().trim().max(1024).optional(),
    filename: z.string().trim().max(256).optional(),
    idempotencyKey: z.string().trim().max(120).optional().nullable(),
  })
  .strict()
  .refine((v) => !!(v.link || v.mediaId), { message: 'link or mediaId is required' });

export const listMessagesQuery = z
  .object({
    direction: messageDirection.optional(),
    status: messageStatus.optional(),
    contactPhone: z.string().trim().max(32).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const listConversationsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

export const messageIdParam = z.object({ id: uuid });
export const templateIdParam = z.object({ id: uuid });

export type UpsertWhatsAppAccountInput = z.infer<typeof upsertWhatsAppAccountSchema>;
export type UpsertWhatsAppTemplateInput = z.infer<typeof upsertWhatsAppTemplateSchema>;
export type SendTextMessageInput = z.infer<typeof sendTextMessageSchema>;
export type SendTemplateMessageInput = z.infer<typeof sendTemplateMessageSchema>;
export type SendMediaMessageInput = z.infer<typeof sendMediaMessageSchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuery>;
export type ListFlowTracesQuery = z.infer<typeof listFlowTracesQuery>;

// Legacy `/chat` wrappers over the messaging module (client Chat panel).
export const chatPhoneParam = z.object({ phone: z.string().trim().min(5).max(32) });
export const chatSendSchema = z
  .object({
    phone: z.string().trim().min(5).max(32),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();
export type ChatSendInput = z.infer<typeof chatSendSchema>;
