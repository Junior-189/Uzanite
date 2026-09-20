import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';

export default function Settings() {
  const { user } = useAuth();
  const { lang, toggleLanguage, t } = useLang();
  const { showToast } = useToast();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = () => {
    showToast(t('settings.refreshing'), 'success');
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-cog text-primary-600 mr-2"></i>
            {t('settings.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('settings.subtitle')}
          </p>
        </div>
      </div>

      {/* Language */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          <i className="fas fa-globe text-primary-600 mr-2"></i>
          {t('settings.language')}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-700">
            {t('settings.current_lang')}:{' '}
            <strong className="text-gray-900">{lang === 'sw' ? 'Kiswahili' : 'English'}</strong>
          </span>
          <button
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            onClick={toggleLanguage}
          >
            <i className="fas fa-language"></i>{' '}
            {t('settings.switch_to')}
          </button>
        </div>
      </div>

      {/* Server Info */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          <i className="fas fa-server text-primary-600 mr-2"></i>
          {t('settings.server_info')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('settings.service')}
            </div>
            <div className="text-sm text-gray-900">{health?.service || 'UZANITE'}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('common.status')}
            </div>
            <div className="text-sm">
              <StatusBadge status="active">{t('common.online')}</StatusBadge>
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('settings.business_label')}
            </div>
            <div className="text-sm text-gray-900">{health?.business || 'default'}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('settings.server_time')}
            </div>
            <div className="text-sm text-gray-900">
              {health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          <i className="fas fa-user text-primary-600 mr-2"></i>
          {t('settings.account_info')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('common.email')}</div>
            <div className="text-sm text-gray-900">{user?.email}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('settings.role')}
            </div>
            <div className="text-sm text-gray-900">{user?.role}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('settings.business_id')}
            </div>
            <div className="text-sm text-gray-900">{user?.businessId}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              {t('common.status')}
            </div>
            <div className="text-sm">
              <StatusBadge status={user?.status}>{user?.status}</StatusBadge>
            </div>
          </div>
        </div>
      </div>

      {/* Data Summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          <i className="fas fa-chart-bar text-primary-600 mr-2"></i>
          {t('settings.data_summary')}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {t('settings.data_summary_desc')}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            <i className="fas fa-chart-line"></i> {t('settings.dashboard')}
          </a>
          <a
            href="/admin/orders"
            className="inline-flex items-center gap-2 bg-success-600 text-white hover:bg-success-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            <i className="fas fa-clipboard-list"></i> {t('settings.orders')}
          </a>
          <a
            href="/admin/products"
            className="inline-flex items-center gap-2 bg-warning-600 text-white hover:bg-warning-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
          >
            <i className="fas fa-tag"></i> {t('settings.products')}
          </a>
          <a
            href="/admin/business"
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <i className="fas fa-store"></i> {t('settings.business_label')}
          </a>
          <a
            href="/admin/whatsapp"
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <i className="fas fa-comments"></i> WhatsApp
          </a>
        </div>
      </div>

      {/* Data Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          <i className="fas fa-sync-alt text-primary-600 mr-2"></i>
          {t('settings.data_actions')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            onClick={handleRefresh}
          >
            <i className="fas fa-sync-alt"></i>{' '}
            {t('settings.refresh_data')}
          </button>
          <a
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <i className="fas fa-chart-line"></i>{' '}
            {t('settings.go_to_dashboard')}
          </a>
        </div>
      </div>
    </div>
  );
}
