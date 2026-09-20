import { z } from 'zod';

// Page-level permissions mirrored from the legacy Express Staff model.
export const STAFF_PERMISSIONS = [
  'dashboard',
  'orders',
  'products',
  'contacts',
  'business',
  'whatsapp',
  'broadcast',
  'expenses',
  'debts',
  'purchases',
  'settings',
  'notifications',
  'recycleBin',
  'reports',
] as const;

export const staffPermission = z.enum(STAFF_PERMISSIONS);

export const staffLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export const createStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(8).max(200),
    permissions: z.array(staffPermission).max(STAFF_PERMISSIONS.length).optional(),
  })
  .strict();

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().toLowerCase().email('Invalid email').optional(),
    permissions: z.array(staffPermission).max(STAFF_PERMISSIONS.length).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

export const resetStaffPasswordSchema = z
  .object({ password: z.string().min(8).max(200) })
  .strict();

export const staffIdParam = z.object({ id: z.string().uuid() });

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ResetStaffPasswordInput = z.infer<typeof resetStaffPasswordSchema>;
