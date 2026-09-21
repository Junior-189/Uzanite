import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import UzerLogo from './UzerLogo';

export default function TopBar({ onMenuToggle }) {
  const { user, logout } = useAuth();
  const { lang, toggleLanguage, t } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const profileRef = useRef(null);

  const [theme, setTheme] = useState(user?.theme || 'light');
  const [themeSaving, setThemeSaving] = useState(false);

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('admin-theme', next); } catch {}
    setThemeSaving(true);
    try {
      const res = await api.put('/auth/theme', { theme: next });
      if (!res.success) throw new Error(res.error || 'Failed');
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    } finally { setThemeSaving(false); }
  };

  const [scrolled, setScrolled] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const activePage = location.pathname.replace('/admin/', '').replace('/admin', '') || 'dashboard';
  const pageTitle = activePage ? t(`nav.${activePage}`) : '';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isSuperAdmin = user?.role === 'super_admin';
  const isSubAdmin = user?.role === 'sub_admin';
  const isStaff = user?.role === 'staff';
  const displayName = user?.name || user?.email || '';
  const initials = displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = isSuperAdmin ? t('sidebar.super_admin') : isSubAdmin ? t('sidebar.sub_admin') : isStaff ? t('sidebar.staff') : t('sidebar.tenant');

  return (
    <nav className={`sticky top-0 z-30 transition-all duration-300 ${scrolled ? 'bg-white/80 backdrop-blur-xl shadow-lg shadow-black/5 border-b border-gray-200/50' : 'bg-white border-b border-gray-100'}`}>
      <div className="safe-top max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-[72px]">

          {/* Left: hamburger + UZANITE logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={onMenuToggle}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              aria-label={t('layout.toggle_menu')}
            >
              <i className="fas fa-bars text-sm"></i>
            </button>
            <div className="flex items-center gap-2.5">
              <UzerLogo size={32} />
              <span className="text-base font-bold text-gray-900 hidden sm:block">UZANITE</span>
            </div>
          </div>

          {/* Right: notifications, theme, language, profile */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => navigate('/admin/notifications')}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
              aria-label={t('notifications.title')}
            >
              <i className="fas fa-bell text-sm"></i>
            </button>
            {user?.role === 'tenant' && (
              <button
                onClick={toggleTheme}
                disabled={themeSaving}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors disabled:opacity-50"
                title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
                aria-label={t('theme.title')}
              >
                <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} text-sm`}></i>
              </button>
            )}
            <button
              onClick={toggleLanguage}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors text-xs font-semibold uppercase"
              aria-label="Toggle language"
            >
              {lang === 'sw' ? 'EN' : 'SW'}
            </button>
            <div ref={profileRef} className="relative">
              <button
                onClick={() => setShowProfile(!showProfile)}
                className="block"
              >
                <div className="w-9 h-9 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {initials}
                </div>
              </button>

              {showProfile && (
                <div className="absolute right-0 mt-2.5 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50">
                  <div className="px-4 py-3.5 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-lg shadow-emerald-400/20">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                        <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                        <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          {roleLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="py-1.5">
                    <button
                      onClick={() => { setShowProfile(false); navigate('/admin/business'); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <i className="fas fa-cog w-4 text-center text-gray-400"></i>
                      {t('sidebar.settings')}
                    </button>
                    <button
                      onClick={() => { setShowProfile(false); logout(); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <i className="fas fa-sign-out-alt w-4 text-center"></i>
                      {t('sidebar.logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
