import { z } from 'zod';
import { uuid } from './common';

// Platform-admin permission catalogue, mirrored from the legacy Express
// `SUB_ADMIN_PERMISSIONS`. Sub-admins are platform users (role `sub_admin`)
// whose `permissions` array is drawn from this list.
export const SUB_ADMIN_PERMISSIONS = [
  'view_tenants',
  'approve_tenants',
  'suspend_tenants',
  'impersonate_tenants',
  'edit_tenants',
  'reset_tenant_passwords',
  'delete_tenants',
  'view_dashboard',
  'manage_orders',
  'manage_products',
  'manage_contacts',
  'manage_whatsapp',
  'manage_broadcast',
  'manage_expenses',
  'manage_purchases',
  'manage_debts',
  'manage_staff',
  'manage_business',
  'manage_settings',
  'manage_notifications',
  'view_reports',
  'access_recycle_bin',
] as const;

export const subAdminPermission = z.enum(SUB_ADMIN_PERMISSIONS);

export const adminUserIdParam = z.object({ id: uuid });

export const adminUserRejectSchema = z
  .object({ reason: z.string().trim().max(500).optional().default('No reason was provided.') })
  .strict();

export const adminUserNameSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export const adminUserEmailSchema = z.object({ email: z.string().trim().toLowerCase().email('Invalid email') }).strict();

export const adminUserSuspendSchema = z.object({ suspended: z.boolean() }).strict();

export const adminUserResetPasswordSchema = z
  .object({ newPassword: z.string().min(8).max(200) })
  .strict();

export const subAdminCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(8).max(200),
    permissions: z.array(subAdminPermission).max(SUB_ADMIN_PERMISSIONS.length).optional().default([]),
  })
  .strict();

export const subAdminUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email('Invalid email').optional(),
    permissions: z.array(subAdminPermission).max(SUB_ADMIN_PERMISSIONS.length).optional(),
  })
  .strict();

export type AdminUserRejectInput = z.infer<typeof adminUserRejectSchema>;
export type SubAdminCreateInput = z.infer<typeof subAdminCreateSchema>;
export type SubAdminUpdateInput = z.infer<typeof subAdminUpdateSchema>;
