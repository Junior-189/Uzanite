// Models that are strictly owned by a single tenant and MUST always be scoped.
// The tenant-scope Prisma extension injects/validates tenantId for these.
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Membership',
  'MembershipInvite',
  'TenantSettings',
  'TenantPaymentMethod',
  'Subscription',
  'UsageCounter',
  // Catalog (Phase M3)
  'Product',
  'StockMovement',
  'Category',
  // Commerce (Phase M4)
  'Order',
  'OrderItem',
  'OrderStatusHistory',
  'OrderCounter',
  // Finance (Phase M5)
  'Payment',
  'PaymentAttempt',
  'LedgerEntry',
  'JournalEntry',
  'JournalLine',
  'Refund',
  // Notifications & Receipts (Phase M6)
  'Notification',
  'Receipt',
  // Files (Phase M15)
  'StoredFile',
  // Messaging (Phase M7)
  'WhatsAppAccount',
  'WhatsAppTemplate',
  'WhatsAppContact',
  'Message',
  // Conversations (Phase M8)
  'Conversation',
  // Flow traces (Phase M9)
  'FlowTrace',
  // Privacy / data-subject requests (Phase M13)
  'PrivacyRequest',
  // Tenant staff accounts (Phase M17)
  'Staff',
  // Finance ledgers (Phase M18)
  'Expense',
  'Purchase',
  'Debt',
  // Broadcast (Phase M20)
  'BroadcastLog',
]);

// Models with an optional tenantId (global + per-tenant rows) are scoped
// explicitly in services, not by the extension:
//   FeatureFlag (global rows have tenantId = null)
//   ActivityLog, OutboxEvent (may be system-level)
export const OPTIONALLY_TENANT_MODELS = new Set<string>([
  'FeatureFlag',
  'ActivityLog',
  'OutboxEvent',
]);
