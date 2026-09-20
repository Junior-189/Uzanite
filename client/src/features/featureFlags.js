import { useAuth } from '../context/AuthContext';

// Feature/page keys that can be enabled/disabled by the admin.
// Order + labels match the server's FEATURE_KEYS; `navKey` lets us show a
// translated label in the admin UI when available.
export const FEATURE_KEYS = [
  { key: 'dashboard', navKey: 'nav.dashboard', label: 'Dashboard' },
  { key: 'orders', navKey: 'nav.orders', label: 'Orders' },
  { key: 'products', navKey: 'nav.products', label: 'Products' },
  { key: 'contacts', navKey: 'nav.contacts', label: 'Contacts' },
  { key: 'whatsapp', navKey: 'nav.whatsapp', label: 'WhatsApp' },
  { key: 'broadcast', navKey: 'nav.broadcast', label: 'Email / Broadcast' },
  { key: 'expenses', navKey: 'nav.expenses', label: 'Expenses' },
  { key: 'purchases', navKey: 'nav.purchases', label: 'Purchases' },
  { key: 'debts', navKey: 'nav.debts', label: 'Debts' },
  { key: 'staff', navKey: 'nav.staff', label: 'Staff' },
  { key: 'reports', navKey: 'nav.reports', label: 'Reports' },
  { key: 'business', navKey: 'nav.settings', label: 'Settings' },
  { key: 'notifications', navKey: 'nav.notifications', label: 'Notifications' },
  { key: 'recycleBin', navKey: 'nav.recycle_bin', label: 'Recycle Bin' },
];

// Returns { enabled, message } for a feature key based on the current user's
// effective feature flags. Super admins and sub-admins are never restricted.
export function useFeatureFlags() {
  const { user } = useAuth();

  const getFlag = (key) => {
    if (!user) return { enabled: true, message: '' };
    if (user.role === 'super_admin' || user.role === 'sub_admin') {
      return { enabled: true, message: '' };
    }
    const flags = user.featureFlags || {};
    const flag = flags[key];
    if (!flag) return { enabled: true, message: '' };
    return { enabled: flag.enabled !== false, message: flag.message || '' };
  };

  const isEnabled = (key) => getFlag(key).enabled;

  return { getFlag, isEnabled, flags: user?.featureFlags || {} };
}
