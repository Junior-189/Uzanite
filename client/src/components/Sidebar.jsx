import { restoreAdminSession, clearSession } from '../utils/tokenStore';
import { clearTenantData } from '../db/helpers';
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import UzerLogo from './UzerLogo';
import api from '../utils/api';

const tenantNavItems = [
  { page: 'dashboard', icon: 'fas fa-chart-line', labelSw: 'Dashibodi', labelEn: 'Dashboard' },
  { page: 'orders', icon: 'fas fa-clipboard-list', labelSw: 'Maagizo', labelEn: 'Orders', badge: 'pendingBadge' },
  { page: 'products', icon: 'fas fa-tag', labelSw: 'Bidhaa', labelEn: 'Products' },
  { page: 'expenses', icon: 'fas fa-receipt', labelSw: 'Gharama', labelEn: 'Expenses' },
  { page: 'purchases', icon: 'fas fa-shopping-cart', labelSw: 'Manunuzi', labelEn: 'Purchases', navKey: 'nav.purchases' },
  { page: 'debts', icon: 'fas fa-hand-holding-usd', labelSw: 'Madeni', labelEn: 'Debts', navKey: 'nav.debts' },
  { page: 'staff', icon: 'fas fa-users', labelSw: 'Wafanyakazi', labelEn: 'Staff', ownerOnly: true, navKey: 'nav.staff' },
  {
    type: 'group',
    key: 'marketing',
    icon: 'fas fa-bullhorn',
    navKey: 'nav.marketing',
    children: [
      { page: 'whatsapp', icon: 'fab fa-whatsapp', navKey: 'nav.whatsapp' },
      { page: 'broadcast', icon: 'fas fa-envelope', navKey: 'nav.broadcast' },
      { page: 'instagram', icon: 'fab fa-instagram', navKey: 'nav.instagram', comingSoon: true },
      { page: 'facebook', icon: 'fab fa-facebook', navKey: 'nav.facebook', comingSoon: true },
      { page: 'offline_sms', icon: 'fas fa-sms', navKey: 'nav.offline_sms', comingSoon: true },
    ],
  },
  { page: 'reports', icon: 'fas fa-file-pdf', labelSw: 'Ripoti', labelEn: 'Reports' },
  { page: 'business', icon: 'fas fa-cog', labelSw: 'Mipangilio', labelEn: 'Settings' },
];

const adminNavItems = [
  { page: 'adminPanel', icon: 'fas fa-shield-alt', labelSw: 'Wasimamizi', labelEn: 'Admin Panel', badge: 'pendingUsersBadge' },
  { page: 'activityLog', icon: 'fas fa-history', labelSw: 'Shughuli', labelEn: 'Activity Log' },
  { page: 'recycleBin', icon: 'fas fa-trash-restore', labelSw: 'Kijalala', labelEn: 'Recycle Bin' },
];

export default function Sidebar({ open, onClose }) {
  const { user, logout, hasPermission } = useAuth();
  const { lang, t, toggleLanguage } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [pendingCount, setPendingCount] = useState(0);
  const [openGroups, setOpenGroups] = useState({ marketing: false });

  useEffect(() => {
    if (user?.role === 'super_admin') {
      api.get('/admin/stats').then((r) => {
        if (r.success && r.stats.pendingUsers > 0) setPendingCount(r.stats.pendingUsers);
      }).catch(() => {});
    }
  }, [user?.role]);

  const activePage = location.pathname.replace('/admin/', '').replace('/admin', '') || 'dashboard';

  const handleNav = (item) => {
    if (item.comingSoon) {
      showToast(t('nav.coming_soon'), 'info');
      return;
    }
    if (!hasPermission(item.page)) return;
    navigate(`/admin/${item.page}`);
    onClose?.();
  };

  const toggleGroup = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const isSuperAdmin = user?.role === 'super_admin';
  const isSubAdmin = user?.role === 'sub_admin';
  const isTenant = user?.role === 'tenant';
  const isStaff = user?.role === 'staff';
  const businessName = user?.businessName || user?.name || t('sidebar.admin_panel');

  const showAdminNav = (isSuperAdmin || isSubAdmin) && !user?.impersonating;
  const navItems = showAdminNav ? adminNavItems : tenantNavItems;

  return (
    <>
      <div
        className={`lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-slate-300 flex flex-col z-50 transition-transform duration-300 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center justify-center gap-3">
            <UzerLogo size={40} />
            <h2 className="text-white font-semibold text-sm leading-tight">UZANITE</h2>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {navItems.map((item) => {
            if (item.ownerOnly && isStaff) return null;
            if (!hasPermission(item.page)) return null;

            // Dropdown group (e.g. Marketing)
            if (item.type === 'group') {
              const groupActive = item.children.some((c) => c.page === activePage);
              const open = openGroups[item.key];
              return (
                <div key={item.key} className="space-y-0.5">
                  <button
                    onClick={() => toggleGroup(item.key)}
                    aria-current={groupActive ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      groupActive
                        ? 'bg-primary-600/20 text-white border-l-[3px] border-primary-400'
                        : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent'
                    }`}
                  >
                    <i className={`fas ${item.icon} w-5 text-center text-xs ${groupActive ? 'text-primary-400' : ''}`}></i>
                    <span className="flex-1 text-left">{item.navKey ? t(item.navKey) : (lang === 'sw' ? item.labelSw : item.labelEn)}</span>
                    <i className={`fas fa-chevron-${open ? 'down' : 'right'} text-[10px] text-slate-500`}></i>
                  </button>
                  {open && (
                    <div className="ml-4 pl-3 border-l border-white/10 space-y-0.5">
                      {item.children.map((child) => {
                        if (!hasPermission(child.page)) return null;
                        const isActive = activePage === child.page;
                        return (
                          <button
                            key={child.page}
                            onClick={() => handleNav(child)}
                            disabled={child.comingSoon}
                            aria-current={isActive ? 'page' : undefined}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                              isActive
                                ? 'bg-primary-600/20 text-white border-l-[3px] border-primary-400'
                                : child.comingSoon
                                  ? 'text-slate-500 cursor-not-allowed border-l-[3px] border-transparent'
                                  : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent'
                            }`}
                          >
                            <i className={`${child.icon} w-5 text-center text-xs ${isActive ? 'text-primary-400' : ''}`}></i>
                            <span className="flex-1 text-left">{child.navKey ? t(child.navKey) : (lang === 'sw' ? child.labelSw : child.labelEn)}</span>
                            {child.comingSoon && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-slate-400">soon</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            const isActive = activePage === item.page;
            return (
              <button
                key={item.page}
                onClick={() => handleNav(item)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-600/20 text-white border-l-[3px] border-primary-400'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border-l-[3px] border-transparent'
                }`}
              >
                <i className={`fas ${item.icon} w-5 text-center text-xs ${isActive ? 'text-primary-400' : ''}`}></i>
                <span className="flex-1 text-left">{item.navKey ? t(item.navKey) : (lang === 'sw' ? item.labelSw : item.labelEn)}</span>
                {item.badge === 'pendingBadge' && pendingCount > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{pendingCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10">
          {user?.impersonating && (
            <button
              onClick={async () => {
                // Restores the admin's own session after impersonating a
                // tenant. Goes through tokenStore so the access token stays in
                // memory and is never persisted.
                await clearTenantData();
                if (restoreAdminSession()) {
                  window.location.href = '/admin/adminPanel';
                } else {
                  clearSession();
                  window.location.href = '/admin/login.html';
                }
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-warning-600 hover:bg-warning-700 text-white text-xs font-semibold transition-colors mb-2"
            >
              <i className="fas fa-arrow-left"></i> {t('sidebar.exit_impersonation')}
            </button>
          )}
          <div className="px-3 py-2 mb-2">
            <div className="text-xs text-slate-400 truncate">{user?.email || t('sidebar.loading')}</div>
            <div className="flex gap-1.5 mt-1.5">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isSuperAdmin ? 'bg-primary-500/20 text-primary-300' : isSubAdmin ? 'bg-purple-500/20 text-purple-300' : isStaff ? 'bg-warning-500/20 text-warning-300' : 'bg-success-500/20 text-success-300'}`}>
                {isSuperAdmin ? t('sidebar.super_admin') : isSubAdmin ? t('sidebar.sub_admin') : isStaff ? t('sidebar.staff') : t('sidebar.tenant')}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-slate-300 capitalize">
                {user?.status || t('sidebar.pending')}
              </span>
            </div>
          </div>
          {!user?.impersonating && (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors"
          >
            <i className="fas fa-sign-out-alt"></i> {t('sidebar.logout')}
          </button>
          )}
        </div>
      </aside>
    </>
  );
}
