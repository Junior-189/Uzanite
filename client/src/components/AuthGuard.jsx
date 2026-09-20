import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { clearSession } from '../utils/tokenStore';

const PAGE_PERMISSION_MAP = {
  dashboard: 'view_dashboard', orders: 'manage_orders', products: 'manage_products',
  contacts: 'manage_contacts', business: 'manage_business', whatsapp: 'manage_whatsapp',
  broadcast: 'manage_broadcast', expenses: 'manage_expenses', purchases: 'manage_purchases',
  debts: 'manage_debts', staff: 'manage_staff',
  notifications: 'manage_notifications', recycleBin: 'access_recycle_bin',
};

const TENANT_ROUTES = ['dashboard', 'orders', 'products', 'contacts', 'business', 'whatsapp', 'broadcast', 'expenses', 'debts', 'purchases', 'staff'];

export default function AuthGuard({ children }) {
  const { token, user } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/admin/login.html" replace />;
  }

  // Accounts bootstrapped/reset by an admin must set a new password first.
  if (user?.mustChangePassword) {
    return <Navigate to="/admin/change-password.html" replace />;
  }

  const isAdmin = user?.role === 'super_admin' || user?.role === 'sub_admin';
  const currentRoute = location.pathname.replace('/admin/', '').split('?')[0];

  if (isAdmin && !user?.impersonating && TENANT_ROUTES.includes(currentRoute)) {
    return <Navigate to="/admin/adminPanel" replace />;
  }

  // Enforce impersonator page restrictions
  if (user?.impersonating && user?.impersonatorPermissions && TENANT_ROUTES.includes(currentRoute)) {
    const requiredPerm = PAGE_PERMISSION_MAP[currentRoute];
    if (requiredPerm && !user.impersonatorPermissions.includes(requiredPerm)) {
      return <Navigate to="/admin/dashboard" replace />;
    }
  }

  if (user?.status === 'pending' && user?.role === 'tenant') {
    if (!user?.whatsappConnected) {
      return <Navigate to="/admin/whatsapp-verification.html" replace />;
    }
    return <Navigate to="/admin/waiting-approval.html" replace />;
  }

  if (user?.status === 'rejected') {
    clearSession();
    return <Navigate to="/admin/login.html" replace />;
  }

  return children;
}
