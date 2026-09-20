import { z } from 'zod';
import { password, uuid } from './common';
import { isKnownPermission } from './permissions';

export const membershipRole = z.enum(['owner', 'manager', 'staff']);
export const membershipStatus = z.enum(['active', 'inactive']);

// Validated against the canonical permission catalogue.
const permissionList = z
  .array(z.string().trim().min(1).max(60).refine(isKnownPermission, 'Unknown permission'))
  .max(50);

export const listMembersQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    cursor: uuid.optional(),
  })
  .strict();

// Adds an EXISTING platform user (by email) to the tenant. When `permissions` is
// omitted, the role's defaults are applied.
export const addMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    role: membershipRole,
    permissions: permissionList.optional().default([]),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    role: membershipRole.optional(),
    permissions: permissionList.optional(),
    status: membershipStatus.optional(),
  })
  .strict();

// Invitation to a NEW user (email may be unknown). Produces a single-use,
// expiring accept-invite link.
export const inviteMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    role: membershipRole,
    permissions: permissionList.optional().default([]),
  })
  .strict();

export const acceptInviteSchema = z
  .object({
    token: z.string().min(10).max(200),
    name: z.string().trim().min(1).max(120),
    password,
  })
  .strict();

export const memberIdParam = z.object({ id: uuid });

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuery>;
