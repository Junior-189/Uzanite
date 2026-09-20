import { z } from 'zod';
import { email, password, phone } from './common';

export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email,
    password,
    // Optional and may be empty (min length only applies when provided).
    phone: phone.optional().or(z.literal('')).default(''),
    businessName: z.string().trim().max(160).optional(),
  })
  .strict();

export const loginSchema = z
  .object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

export const logoutSchema = z.object({ refreshToken: z.string().min(10).optional() }).strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1), newPassword: password })
  .strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z
  .object({ token: z.string().min(10), newPassword: password })
  .strict();

// ── TOTP two-factor ──────────────────────────────────────────────────────────
// Second step of login: exchange the short-lived challenge for a session.
export const loginMfaSchema = z
  .object({ mfaToken: z.string().min(10), code: z.string().trim().min(6).max(10) })
  .strict();

export const totpCodeSchema = z.object({ code: z.string().trim().min(6).max(10) }).strict();

export const totpDisableSchema = z
  .object({ password: z.string().min(1), code: z.string().trim().min(6).max(10) })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginMfaInput = z.infer<typeof loginMfaSchema>;
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

// Legacy `/auth/theme` — tenant UI theme preference.
export const themeSchema = z.object({ theme: z.enum(['light', 'dark']) }).strict();
export type ThemeInput = z.infer<typeof themeSchema>;
