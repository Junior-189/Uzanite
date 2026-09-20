// Central Zod schemas for write endpoints (Phase 1).
// Unknown keys are stripped by default; `.strict()` is used on the highest-risk
// bodies so unexpected fields are rejected outright.
const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const shortText = (max = 200) => z.string().trim().max(max);
const phone = z.string().trim().min(5).max(25);
const nonNegNumber = z.coerce.number().min(0);
const email = z.string().trim().toLowerCase().email('Invalid email');

const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[A-Z]/, 'At least 1 uppercase letter')
  .regex(/[a-z]/, 'At least 1 lowercase letter')
  .regex(/[0-9]/, 'At least 1 number')
  .regex(/[^A-Za-z0-9]/, 'At least 1 special character');

// ── Auth ────────────────────────────────────────────────────────────────────
const registerSchema = z
  .object({
    name: shortText(120).min(1),
    email,
    password,
    phone: z.string().trim().max(25).optional().default(''),
    businessName: shortText(160).optional(),
  })
  .strict();

const loginSchema = z
  .object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) })
  .strict();

const googleSchema = z.object({ idToken: z.string().min(10) }).strict();

const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1), newPassword: password })
  .strict();

const forgotPasswordSchema = z.object({ email }).strict();

const resetPasswordSchema = z
  .object({ token: z.string().min(10), newPassword: password })
  .strict();

// ── Businesses ──────────────────────────────────────────────────────────────
const businessCreateSchema = z
  .object({
    businessId: z.string().trim().max(60).optional(),
    name: shortText(160).min(1),
    phone,
    description: z.string().max(1000).optional().default(''),
    currency: z.string().trim().max(8).optional().default('TZS'),
    mpesaNumber: z.string().trim().max(25).optional(),
    mpesaName: z.string().trim().max(80).optional(),
    tigoNumber: z.string().trim().max(25).optional(),
    airtelNumber: z.string().trim().max(25).optional(),
  })
  .strict();

const businessUpdateSchema = z
  .object({
    name: shortText(160).optional(),
    phone: z.string().trim().max(25).optional(),
    description: z.string().max(1000).optional(),
    currency: z.string().trim().max(8).optional(),
    active: z.boolean().optional(),
    mpesaNumber: z.string().trim().max(25).optional(),
    mpesaName: z.string().trim().max(80).optional(),
    tigoNumber: z.string().trim().max(25).optional(),
    airtelNumber: z.string().trim().max(25).optional(),
  })
  .strict();

// ── Products ────────────────────────────────────────────────────────────────
const productCreateSchema = z
  .object({
    name: shortText(160).min(1),
    description: z.string().max(2000).optional().default(''),
    price: nonNegNumber,
    minPrice: nonNegNumber.optional(),
    cost: nonNegNumber.optional(),
    currency: z.string().trim().max(8).optional(),
    stock: nonNegNumber.optional(),
    barcode: z.string().trim().max(64).optional().nullable(),
    expiryDate: z.string().trim().optional().nullable(),
    expiryWarnDays: z.coerce.number().int().min(0).max(3650).optional(),
    clientRef: z.string().trim().max(120).optional(),
  })
  .strict();

const productUpdateSchema = productCreateSchema.partial().strict();

const restockSchema = z
  .object({ quantity: z.coerce.number().positive(), expiryDate: z.string().trim().optional().nullable() })
  .strict();

// ── Orders ──────────────────────────────────────────────────────────────────
const orderItemSchema = z.object({
  productId: z.union([objectId, z.literal('')]).optional().nullable(),
  productName: z.string().trim().max(200).optional().default(''),
  price: nonNegNumber.optional().default(0),
  quantity: z.coerce.number().int().min(1),
  subtotal: nonNegNumber.optional(),
  currency: z.string().trim().max(8).optional(),
});

const manualOrderSchema = z
  .object({
    customerName: shortText(120).optional(),
    customerPhone: phone.optional(),
    customerEmail: email.optional().or(z.literal('')),
    items: z.array(orderItemSchema).min(1, 'Items are required'),
    clientRef: z.string().trim().max(120).optional(),
  })
  .strict();

const orderRejectSchema = z.object({ reason: z.string().max(500).optional().default('') }).strict();
const orderNoteSchema = z.object({ note: z.string().max(500).optional().default('') }).strict();
const confirmPaymentSchema = z
  .object({
    method: z.string().trim().max(40).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

// ── Expenses / Debts / Purchases ────────────────────────────────────────────
const expenseCreateSchema = z
  .object({
    description: shortText(300).min(1),
    amount: nonNegNumber,
    category: z.string().trim().max(80).optional(),
    date: z.string().trim().optional(),
  })
  .strict();

const debtCreateSchema = z
  .object({
    customerName: shortText(120).min(1),
    customerPhone: z.string().trim().max(25).optional(),
    amount: nonNegNumber,
    description: z.string().max(500).optional(),
    dueDate: z.string().trim().optional().nullable(),
    orderId: z.union([objectId, z.literal('')]).optional().nullable(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const debtPaySchema = z
  .object({ paymentAmount: z.coerce.number().positive(), notes: z.string().max(1000).optional() })
  .strict();

// Debt update is intentionally an allow-list (no businessId/paidAmount/status).
const debtUpdateSchema = z
  .object({
    customerName: shortText(120).optional(),
    customerPhone: z.string().trim().max(25).optional(),
    amount: nonNegNumber.optional(),
    description: z.string().max(500).optional(),
    dueDate: z.string().trim().optional().nullable(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const purchaseCreateSchema = z
  .object({
    productName: shortText(200).min(1),
    quantity: z.coerce.number().int().min(1),
    costPerUnit: nonNegNumber,
    supplier: z.string().trim().max(160).optional(),
    date: z.string().trim().optional(),
    notes: z.string().max(1000).optional(),
    expiryDate: z.string().trim().optional().nullable(),
    clientRef: z.string().trim().max(120).optional(),
    productId: z.union([objectId, z.literal('')]).optional().nullable(),
    receiptPath: z.string().max(500).optional(),
  })
  .strict();

const purchaseUpdateSchema = z
  .object({
    productName: shortText(200).optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    costPerUnit: nonNegNumber.optional(),
    supplier: z.string().trim().max(160).optional(),
    notes: z.string().max(1000).optional(),
    expiryDate: z.string().trim().optional().nullable(),
    date: z.string().trim().optional(),
    receiptPath: z.string().max(500).optional(),
  })
  .strict();

// ── Contacts / Broadcast / Chat ─────────────────────────────────────────────
const contactCreateSchema = z
  .object({ phone: phone, name: shortText(120).optional() })
  .strict();

const contactUpdateSchema = z
  .object({ name: shortText(120).optional(), email: z.string().trim().max(200).optional() })
  .strict();

const contactEmailSchema = z
  .object({ subject: shortText(200).min(1), message: z.string().min(1).max(5000) })
  .strict();

const broadcastSendSchema = z
  .object({
    message: z.string().min(1).max(4000),
    subject: z.string().max(200).optional(),
    channel: z.enum(['whatsapp', 'email', 'both']).optional().default('whatsapp'),
  })
  .strict();

const broadcastContactSchema = z
  .object({ email: z.string().trim().min(3), name: shortText(120).optional() })
  .strict();

const broadcastImportSchema = z.object({ data: z.union([z.string(), z.array(z.any()), z.object({})]) }).strict();

const chatSendSchema = z
  .object({ phone, message: z.string().min(1).max(4000) })
  .strict();

// ── Staff ───────────────────────────────────────────────────────────────────
const staffCreateSchema = z
  .object({
    name: shortText(120).min(1),
    email,
    password: z.string().min(8).max(128),
    permissions: z.array(z.string().max(40)).optional().default([]),
  })
  .strict();

const staffUpdateSchema = z
  .object({
    name: shortText(120).optional(),
    email: z.string().trim().toLowerCase().optional(),
    permissions: z.array(z.string().max(40)).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();

const staffResetSchema = z.object({ password: z.string().min(8).max(128) }).strict();

// ── Admin ───────────────────────────────────────────────────────────────────
const adminRejectSchema = z.object({ reason: z.string().max(500).optional() }).strict();
const adminResetSchema = z.object({ newPassword: password }).strict();
const adminNameSchema = z.object({ name: shortText(120).min(1) }).strict();
const adminEmailSchema = z.object({ email }).strict();
const adminSuspendSchema = z.object({ suspended: z.boolean() }).strict();

const subAdminCreateSchema = z
  .object({
    name: shortText(120).min(1),
    email,
    password,
    permissions: z.array(z.string().max(40)).optional().default([]),
  })
  .strict();

const subAdminUpdateSchema = z
  .object({
    name: shortText(120).optional(),
    email: z.string().trim().toLowerCase().optional(),
    permissions: z.array(z.string().max(40)).optional(),
  })
  .strict();

const featureFlagsSchema = z.object({ flags: z.record(z.string(), z.any()) }).strict();

const billingPlanSchema = z
  .object({
    plan: z.enum(['free', 'pro', 'business']),
    subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled']).optional(),
    trialEndsAt: z.string().trim().optional().nullable(),
    currentPeriodEnd: z.string().trim().optional().nullable(),
  })
  .strict();

// ── WhatsApp ────────────────────────────────────────────────────────────────
const whatsappBusinessQuerySchema = z.object({ businessId: z.string().trim().max(60).optional() }).strict();

// ── Payments (Phase 3) ──────────────────────────────────────────────────────
const paymentInitiateSchema = z
  .object({
    phone: z.string().trim().max(25).optional(),
    method: z.string().trim().max(30).optional(),
    provider: z.enum(['manual', 'clickpesa', 'azampay']).optional().default('manual'),
  })
  .strict();

const paymentManualSchema = z
  .object({
    method: z.string().trim().max(30).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

// ── Privacy / consent (Phase 3) ─────────────────────────────────────────────
const privacyEraseSchema = z
  .object({
    phone: z.string().trim().max(25).optional(),
    email: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => v.phone || v.email, { message: 'phone or email is required' });

const consentSchema = z
  .object({
    phone: z.string().trim().max(25).optional(),
    email: z.string().trim().max(200).optional(),
    channel: z.enum(['whatsapp', 'email', 'sms', 'any']).optional().default('any'),
    action: z.enum(['granted', 'revoked']),
  })
  .strict()
  .refine((v) => v.phone || v.email, { message: 'phone or email is required' });

const metaCredentialsSchema = z
  .object({
    phoneNumberId: z.string().trim().min(3).max(64),
    wabaId: z.string().trim().max(64).optional().default(''),
    accessToken: z.string().trim().min(10).max(4096),
    displayPhoneNumber: z.string().trim().max(32).optional().default(''),
    verifyToken: z.string().trim().max(128).optional().default(''),
  })
  .strict();

const templateSendSchema = z
  .object({
    phone: z.string().trim().min(5).max(25),
    name: z.string().trim().min(1).max(120),
    language: z.string().trim().max(20).optional().default('en_US'),
    components: z.array(z.any()).optional().default([]),
  })
  .strict();

module.exports = {
  // auth
  registerSchema,
  loginSchema,
  googleSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  // businesses
  businessCreateSchema,
  businessUpdateSchema,
  // products
  productCreateSchema,
  productUpdateSchema,
  restockSchema,
  // orders
  manualOrderSchema,
  orderRejectSchema,
  orderNoteSchema,
  confirmPaymentSchema,
  // expenses / debts / purchases
  expenseCreateSchema,
  debtCreateSchema,
  debtPaySchema,
  debtUpdateSchema,
  purchaseCreateSchema,
  purchaseUpdateSchema,
  // contacts / broadcast / chat
  contactCreateSchema,
  contactUpdateSchema,
  contactEmailSchema,
  broadcastSendSchema,
  broadcastContactSchema,
  broadcastImportSchema,
  chatSendSchema,
  // staff
  staffCreateSchema,
  staffUpdateSchema,
  staffResetSchema,
  // admin
  adminRejectSchema,
  adminResetSchema,
  adminNameSchema,
  adminEmailSchema,
  adminSuspendSchema,
  subAdminCreateSchema,
  subAdminUpdateSchema,
  featureFlagsSchema,
  billingPlanSchema,
  // payments
  paymentInitiateSchema,
  paymentManualSchema,
  // privacy / consent
  privacyEraseSchema,
  consentSchema,
  // misc
  whatsappBusinessQuerySchema,
  metaCredentialsSchema,
  templateSendSchema,
};
