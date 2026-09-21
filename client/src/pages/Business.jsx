import { confirmDialog, promptDialog } from '../utils/dialog';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import {
  BUSINESS_PROVIDERS,
  adaptPlatformTenant,
  businessProfilePath,
  normalizeBusiness,
  paymentMethodPayload,
  tenantsOnPlatform,
} from '../utils/tenantBridge';
import StatusBadge from '../components/StatusBadge';
import Notifications from './Notifications';
import RecycleBin from './RecycleBin';

function BusinessTab({ t }) {
  const { showToast } = useToast();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => { fetchBusiness(); }, []);

  const fetchBusiness = async () => {
    setLoading(true);
    try {
      const res = await api.get(businessProfilePath());
      const raw = tenantsOnPlatform()
        ? (res.tenant ? adaptPlatformTenant(res.tenant) : null)
        : (res.success && res.businesses?.length > 0 ? res.businesses[0] : null);
      if (raw) {
        const normalized = normalizeBusiness(raw);
        setBusiness(normalized);
        setForm(normalized);
      }
    } catch { showToast(t('business.failed_to_load'), 'error'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    try {
      // Platform tenancy: core fields via PUT /tenants/me, payment numbers via
      // the per-provider upsert endpoint.
      if (tenantsOnPlatform()) {
        await api.put('/tenants/me', { name: form.name, phone: form.phone, currency: form.currency });
        for (const provider of BUSINESS_PROVIDERS) {
          const number = form[`${provider}Number`];
          if (number) {
            await api.post('/tenants/me/payment-methods', paymentMethodPayload(provider, number, form[`${provider}Name`] || ''));
          }
        }
        await fetchBusiness();
        setEditing(false);
        showToast(t('business.confirmed_updated'), 'success');
        return;
      }
      const res = await api.put(`/businesses/${business.businessId || business._id}`, form);
      if (res.success) {
        const b = res.business || form;
        const normalized = {
          ...b,
          mpesaNumber: b.payment?.mpesa?.number || form.mpesaNumber || '',
          mpesaName: b.payment?.mpesa?.name || form.mpesaName || '',
          tigoNumber: b.payment?.tigo?.number || form.tigoNumber || '',
          airtelNumber: b.payment?.airtel?.number || form.airtelNumber || '',
          currency: b.currency || form.currency || 'TZS',
        };
        setBusiness(normalized);
        setForm(normalized);
        setEditing(false);
        showToast(t('business.confirmed_updated'), 'success');
      }
    } catch (err) { showToast(err.error || t('business.failed_update'), 'error'); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;

  if (!business) return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
      <i className="fas fa-store text-5xl text-gray-300 mb-4"></i>
      <h3 className="text-lg font-semibold text-gray-600">{t('business.no_business')}</h3>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{business.businessId}</p>
        <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium" onClick={() => setEditing(!editing)}>
          <i className="fas fa-pen mr-1"></i> {t('common.edit')}
        </button>
      </div>

      {editing ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.business_name')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.phone')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.mpesa_number')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.mpesaNumber || ''} onChange={(e) => setForm({ ...form, mpesaNumber: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.mpesa_name')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.mpesaName || ''} onChange={(e) => setForm({ ...form, mpesaName: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.tigo_pesa')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.tigoNumber || ''} onChange={(e) => setForm({ ...form, tigoNumber: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.airtel_money')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.airtelNumber || ''} onChange={(e) => setForm({ ...form, airtelNumber: e.target.value })} />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('business.currency')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.currency || 'TZS'} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </div>
          <div className="flex gap-3">
            <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={handleSave}>{t('common.save')}</button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.business_name')}</div>
              <div className="text-sm font-medium text-gray-900">{business.name}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.phone')}</div>
              <div className="text-sm font-medium text-gray-900">{business.phone || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.currency')}</div>
              <div className="text-sm font-medium text-gray-900">{business.currency || 'TZS'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.mpesa_number')}</div>
              <div className="text-sm font-medium text-gray-900">{business.mpesaNumber || 'N/A'} ({business.mpesaName || 'N/A'})</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.tigo_pesa')}</div>
              <div className="text-sm font-medium text-gray-900">{business.tigoNumber || 'N/A'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('business.airtel_money')}</div>
              <div className="text-sm font-medium text-gray-900">{business.airtelNumber || 'N/A'}</div>
            </div>
          </div>
        </div>
      )}

      <ThemeCard t={t} />
    </div>
  );
}

function ThemeCard({ t }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [theme, setTheme] = useState(user?.theme || 'light');
  const [saving, setSaving] = useState(false);

  if (user?.role !== 'tenant') return null;

  const choose = async (value) => {
    setTheme(value);
    document.documentElement.setAttribute('data-theme', value);
    try { localStorage.setItem('admin-theme', value); } catch {}
    setSaving(true);
    try {
      const res = await api.put('/auth/theme', { theme: value });
      if (!res.success) throw new Error(res.error || 'Failed');
      showToast(t('theme.saved'), 'success');
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    } finally { setSaving(false); }
  };

  const options = [
    { value: 'light', icon: 'fa-sun', label: t('theme.light') },
    { value: 'dark', icon: 'fa-moon', label: t('theme.dark') },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        <i className="fas fa-palette text-primary-600 mr-2"></i>{t('theme.title')}
      </h3>
      <p className="text-xs text-gray-500 mb-4">{t('theme.desc')}</p>
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        {options.map((o) => {
          const active = theme === o.value;
          return (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              disabled={saving}
              className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border text-sm font-medium transition-all disabled:opacity-50 ${
                active
                  ? 'border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              <i className={`fas ${o.icon} text-lg`}></i>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PrivacyCard({ t }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const data = await api.get('/privacy/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'uzanite-export.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('privacy.exported'), 'success');
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleErase = async () => {
    const phone = await promptDialog(t('privacy.erase_phone_prompt'));
    if (phone === null) return;
    let email = '';
    if (!phone.trim()) {
      email = await promptDialog(t('privacy.erase_email_prompt')) || '';
      if (!email.trim()) return;
    }
    if (!(await confirmDialog(t('privacy.erase_confirm')))) return;
    setBusy(true);
    try {
      await api.post('/privacy/erase', phone.trim() ? { phone: phone.trim() } : { email: email.trim() });
      showToast(t('privacy.erased'), 'success');
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">
        <i className="fas fa-shield-alt text-primary-600 mr-2"></i>{t('privacy.title')}
      </h3>
      <p className="text-xs text-gray-500 mb-4">{t('privacy.desc')}</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={handleExport} className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50">
          <i className="fas fa-download"></i> {t('privacy.export_data')}
        </button>
        <button disabled={busy} onClick={handleErase} className="inline-flex items-center gap-2 bg-white text-danger-700 border border-danger-200 hover:bg-danger-50 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50">
          <i className="fas fa-user-slash"></i> {t('privacy.erase_data')}
        </button>
      </div>
    </div>
  );
}

function SettingsTab({ t }) {
  const { user } = useAuth();
  const { lang, toggleLanguage } = useLang();
  const { showToast } = useToast();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/health').then((r) => r.json()).then(setHealth).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleRefresh = () => { showToast(t('settings.refreshing'), 'success'); window.location.reload(); };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div></div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><i className="fas fa-globe text-primary-600 mr-2"></i>{t('settings.language')}</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-700">{t('settings.current_lang')}: <strong className="text-gray-900">{lang === 'sw' ? 'Kiswahili' : 'English'}</strong></span>
          <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" onClick={toggleLanguage}>
            <i className="fas fa-language"></i> {t('settings.switch_to')}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><i className="fas fa-server text-primary-600 mr-2"></i>{t('settings.server_info')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('settings.service')}</div>
            <div className="text-sm text-gray-900">{health?.service || 'UZANITE'}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('common.status')}</div>
            <div className="text-sm"><StatusBadge status="active">{t('common.online')}</StatusBadge></div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('settings.server_time')}</div>
            <div className="text-sm text-gray-900">{health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—'}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><i className="fas fa-user text-primary-600 mr-2"></i>{t('settings.account_info')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('common.email')}</div>
            <div className="text-sm text-gray-900">{user?.email}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('settings.role')}</div>
            <div className="text-sm text-gray-900">{user?.role}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('settings.business_id')}</div>
            <div className="text-sm text-gray-900">{user?.businessId}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{t('common.status')}</div>
            <div className="text-sm"><StatusBadge status={user?.status}>{user?.status}</StatusBadge></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3"><i className="fas fa-sync-alt text-primary-600 mr-2"></i>{t('settings.data_actions')}</h3>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={handleRefresh}>
            <i className="fas fa-sync-alt"></i> {t('settings.refresh_data')}
          </button>
        </div>
      </div>

      <PrivacyCard t={t} />
    </div>
  );
}

const SETTINGS_TABS = [
  { key: 'business', labelKey: 'settings.business_tab', icon: 'fa-store' },
  { key: 'settings', labelKey: 'settings.settings_tab', icon: 'fa-cog' },
  { key: 'notifications', labelKey: 'settings.notifications_tab', icon: 'fa-bell' },
  { key: 'recycleBin', labelKey: 'settings.recyclebin_tab', icon: 'fa-trash-restore' },
];

export default function Business() {
  const { t } = useLang();
  const [tab, setTab] = useState('business');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <i className="fas fa-cog text-primary-600"></i> {t('business.settings')}
        </h1>
      </div>

      <div className="flex bg-gray-100 rounded-xl p-1 w-fit flex-wrap" role="tablist">
        {SETTINGS_TABS.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} role="tab" aria-selected={tab === item.key}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${tab === item.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <i className={`fas ${item.icon} text-xs`}></i> {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'business' && <BusinessTab t={t} />}
      {tab === 'settings' && <SettingsTab t={t} />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'recycleBin' && <RecycleBin />}
    </div>
  );
}
