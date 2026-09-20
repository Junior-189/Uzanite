import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, refreshPermissions } = useAuth();
  const { t } = useLang();
  const location = useLocation();

  useEffect(() => { refreshPermissions(); }, []);
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  // Apply the tenant's theme preference to the whole app (light/dark).
  // user.theme is the source of truth; localStorage smooths first paint.
  useEffect(() => {
    const theme = user?.theme || localStorage.getItem('admin-theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('admin-theme', theme); } catch {}
  }, [user?.theme]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="lg:ml-64 min-h-screen flex flex-col">
        {user?.impersonating && (
          <div className="bg-warning-500 text-white px-4 py-2 flex items-center justify-between text-xs font-semibold sticky top-0 z-20">
            <div className="flex items-center gap-2">
              <i className="fas fa-eye"></i>
              <span>{t('layout.impersonating')}<strong>{user?.name || user?.email}</strong></span>
            </div>
            <button
              onClick={() => {
                // Restores the admin's own session after impersonating a
                // tenant. Goes through tokenStore so the access token stays in
                // memory and is never persisted.
                if (restoreAdminSession()) {
                  window.location.href = '/admin/adminPanel';
                } else {
                  clearSession();
                  window.location.href = '/admin/login.html';
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors"
            >
              <i className="fas fa-arrow-left"></i> {t('layout.exit')}
            </button>
          </div>
        )}

        <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

        <div className="flex-1 max-w-[1400px] w-full mx-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
