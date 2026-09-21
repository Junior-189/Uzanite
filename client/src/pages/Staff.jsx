import { confirmDialog, promptDialog } from '../utils/dialog';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLang } from '../context/LangContext';
import api from '../utils/api';
import { fetchCached, clearCache } from '../utils/cache';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import StatCard from '../components/StatCard';
import { KebabMenu, DetailModal } from '../components/TableDetail';
import { rowActivate } from '../utils/rowActivate';

const ALL_PERMISSIONS = [
  { key: 'dashboard', icon: 'fa-chart-line' },
  { key: 'orders', icon: 'fa-clipboard-list' },
  { key: 'products', icon: 'fa-tag' },
  { key: 'contacts', icon: 'fa-address-book' },
  { key: 'business', icon: 'fa-store' },
  { key: 'whatsapp', icon: 'fa-comments' },
  { key: 'broadcast', icon: 'fa-bullhorn' },
  { key: 'expenses', icon: 'fa-receipt' },
  { key: 'debts', icon: 'fa-hand-holding-usd' },
  { key: 'purchases', icon: 'fa-shopping-cart' },
  { key: 'settings', icon: 'fa-cog' },
  { key: 'notifications', icon: 'fa-bell' },
  { key: 'recycleBin', icon: 'fa-trash-restore' },
  { key: 'reports', icon: 'fa-file-pdf' },
];

export default function Staff() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t } = useLang();
  const [staff, setStaff] = useState([]);
  const [ownerCounts, setOwnerCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editStaff, setEditStaff] = useState(null);
  const [showResetPw, setShowResetPw] = useState(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', permissions: [] });
  const [showLoginHistory, setShowLoginHistory] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [detail, setDetail] = useState(null);

  const openDetail = (s) => setDetail(s);
  const staffFields = (s) => ([
    { label: t('staff.col_name'), value: s.name },
    { label: t('staff.col_email'), value: s.email },
    { label: t('staff.col_orders'), value: s.orderCount || 0 },
    { label: t('staff.col_last_login'), value: s.lastLogin ? `${new Date(s.lastLogin).toLocaleDateString()} ${new Date(s.lastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : t('staff.never') },
    { label: t('staff.col_status'), value: s.status },
    ...(s.permissions && s.permissions.length ? [{ label: t('staff.permissions_label'), value: s.permissions.join(', ') }] : []),
  ]);

  useEffect(() => { fetchStaff(); }, []);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      clearCache('staff-list');
      const res = await fetchCached('staff-list', () => api.get('/staff'));
      if (res.success) {
        setStaff(res.staff || []);
        setOwnerCounts(res.ownerCounts || null);
      }
    } catch {
      showToast(t('common.failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editStaff) {
        await api.put(`/staff/${editStaff._id}`, { name: form.name, email: form.email, permissions: form.permissions });
        showToast(t('staff.confirmed_staff_updated'), 'success');
      } else {
        await api.post('/staff', form);
        showToast(t('staff.confirmed_staff_created'), 'success');
      }
      setShowForm(false);
      setEditStaff(null);
      setForm({ name: '', email: '', password: '', permissions: [] });
      fetchStaff();
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    }
  };

  const handleDelete = async (id, name) => {
    if (!(await confirmDialog(t('staff.confirm_delete', { name })))) return;
    try {
      await api.delete(`/staff/${id}`);
      showToast(t('staff.confirmed_deleted'), 'success');
      fetchStaff();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/staff/${id}`, { status: newStatus });
      showToast(t('staff.confirmed_status_changed', { status: t(`staff.${newStatus}`) }), 'success');
      fetchStaff();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!showResetPw || !resetPwValue) return;
    try {
      await api.put(`/staff/${showResetPw._id}/reset-password`, { password: resetPwValue });
      showToast(t('staff.confirmed_password_reset'), 'success');
      setShowResetPw(null);
      setResetPwValue('');
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    }
  };

  const openEdit = (s) => {
    setEditStaff(s);
    setForm({ name: s.name, email: s.email, password: '', permissions: s.permissions || [] });
    setShowForm(true);
  };

  const togglePerm = (perm) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }));
  };

  if (user?.role === 'staff') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <i className="fas fa-lock text-4xl text-gray-300 mb-3"></i>
          <h3 className="text-lg font-semibold text-gray-600">{t('staff.access_denied')}</h3>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i className="fas fa-users text-primary-600"></i> {t('staff.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('staff.members_count', { count: staff.length })}</p>
        </div>
        <div className="flex gap-3">
          <button
            className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
            onClick={() => setShowReportModal(true)}
          >
            <i className="fas fa-file-pdf mr-1"></i> {t('staff.report')}
          </button>
          <button
            className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
            onClick={() => setShowForm(true)}
          >
            <i className="fas fa-plus mr-1"></i> {t('staff.add_staff')}
          </button>
        </div>
      </div>

      {loading ? (
        <StaffAnalyticsSkeleton />
      ) : (
        <StaffAnalytics staff={staff} ownerCounts={ownerCounts} t={t} />
      )}

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {editStaff ? t('staff.edit_staff') : t('staff.add_staff')}
            </h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.name')}</label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.email')}</label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
            </div>
            {!editStaff && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.password')}</label>
                <input
                  className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={8}
                  placeholder={t('staff.min_8_chars')}
                />
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff.permissions_label')}</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-2">
                {ALL_PERMISSIONS.map((p) => (
                  <label
                    key={p.key}
                    className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer text-xs font-medium transition-colors ${
                      form.permissions.includes(p.key)
                        ? 'bg-primary-50 border-primary-300 text-primary-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(p.key)}
                      onChange={() => togglePerm(p.key)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500/20"
                    />
                    <i className={`fas ${p.icon} text-gray-400`}></i> {p.key}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => { setShowForm(false); setEditStaff(null); }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold"
              >
                {editStaff ? t('common.update') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {showResetPw && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4 border-l-4 border-l-warning-500">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <i className="fas fa-key text-warning-500"></i> {t('staff.reset_pw_title', { name: showResetPw.name })}
            </h3>
          </div>
          <form onSubmit={handleResetPassword}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('staff.new_password')}</label>
              <input
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                type="password"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                required
                minLength={8}
                placeholder={t('staff.password_placeholder')}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => { setShowResetPw(null); setResetPwValue(''); }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="bg-warning-500 text-white hover:bg-warning-600 px-4 py-2 rounded-xl text-sm font-semibold"
              >
                {t('staff.reset_password')}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <i className="fas fa-users text-5xl text-gray-300 mb-4"></i>
          <h3 className="text-lg font-semibold text-gray-600 mb-2">{t('staff.no_staff')}</h3>
          <p className="text-sm text-gray-500">{t('staff.no_staff_hint')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden anim-fade-up">
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('staff.col_name')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('staff.col_email')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('staff.col_orders')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('staff.col_last_login')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{t('staff.col_status')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">{t('staff.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr
                    key={s._id}
                    onClick={() => openDetail(s)}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{s.name}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{s.orderCount || 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {s.lastLogin ? (
                          <span className="text-xs text-gray-500">
                            {new Date(s.lastLogin).toLocaleDateString()} {new Date(s.lastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : (
                          <em className="text-xs text-gray-400">{t('staff.never')}</em>
                        )}
                        {s.loginHistory && s.loginHistory.length > 0 && (
                          <button
                            className="text-xs px-2 py-1 rounded-lg font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); setShowLoginHistory(s); }}
                            title={t('staff.view_login_history')}
                          >
                            <i className="fas fa-history"></i>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <KebabMenu
                        t={t}
                        items={[
                      { label: t('common.view'), icon: 'fa-eye', cls: 'text-gray-700 hover:bg-gray-50', run: () => openDetail(s) },
                      { label: t('staff.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(s) },
                          { label: t('staff.reset_password'), icon: 'fa-key', cls: 'text-gray-700 hover:bg-gray-50', run: () => { setShowResetPw(s); setResetPwValue(''); } },
                          { label: s.status === 'active' ? t('staff.inactive') : t('staff.active'), icon: s.status === 'active' ? 'fa-ban' : 'fa-check', cls: 'text-gray-700 hover:bg-gray-50', run: () => handleToggleStatus(s._id, s.status) },
                          { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(s._id, s.name) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile Cards */}
          <div className="md:hidden divide-y divide-gray-100 anim-fade-up">
            {staff.map((s) => (
              <div key={s._id} className="p-4 cursor-pointer" {...rowActivate(() => openDetail(s))}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-gray-900">{s.name}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-xs text-gray-400 mb-1">{s.email}</div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                  <span>{t('staff.orders_count')} <strong className="text-gray-900">{s.orderCount || 0}</strong></span>
                  {s.lastLogin && <span>{t('staff.last_login')} {new Date(s.lastLogin).toLocaleDateString()}</span>}
                </div>
                <div className="flex items-center gap-2" role="presentation" onClick={(e) => e.stopPropagation()}>
                  <KebabMenu
                    t={t}
                    items={[
                      { label: t('common.view'), icon: 'fa-eye', cls: 'text-gray-700 hover:bg-gray-50', run: () => openDetail(s) },
                      { label: t('staff.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(s) },
                      { label: t('staff.reset_pw'), icon: 'fa-key', cls: 'text-gray-700 hover:bg-gray-50', run: () => { setShowResetPw(s); setResetPwValue(''); } },
                      { label: t('staff.history'), icon: 'fa-history', cls: 'text-gray-700 hover:bg-gray-50', run: () => setShowLoginHistory(s) },
                      { label: s.status === 'active' ? t('staff.inactive') : t('staff.active'), icon: s.status === 'active' ? 'fa-ban' : 'fa-check', cls: 'text-gray-700 hover:bg-gray-50', run: () => handleToggleStatus(s._id, s.status) },
                      { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(s._id, s.name) },
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showLoginHistory && (
        <Modal onClose={() => setShowLoginHistory(null)}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <i className="fas fa-history text-primary-600"></i> {t('staff.login_history_title', { name: showLoginHistory.name })}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => setShowLoginHistory(null)}
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            <div className="max-h-[350px] overflow-y-auto">
              {(!showLoginHistory.loginHistory || showLoginHistory.loginHistory.length === 0) ? (
                <p className="text-center text-gray-400 py-8">{t('staff.no_login_history')}</p>
              ) : (
                [...showLoginHistory.loginHistory].reverse().map((ts, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-2.5 px-4 border-b border-gray-100 last:border-0"
                  >
                    <span className="text-sm text-gray-700">{new Date(ts).toLocaleDateString()}</span>
                    <span className="text-xs text-gray-500">
                      {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => setShowLoginHistory(null)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('staff', 'staff-report.pdf', p)} />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name || t('staff.title')}
        fields={detail ? staffFields(detail) : []}
        footer={detail && (
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { const s = detail; setDetail(null); openEdit(s); }}>
            <i className="fas fa-pen mr-1.5"></i> {t('staff.edit')}
          </button>
        )}
      />
    </div>
  );
}

const CHART_META = [
  { key: 'orders', color: 'green', chartColor: '#059669', titleKey: 'staff.chart_orders', icon: 'fa-clipboard-list' },
  { key: 'purchases', color: 'green', chartColor: '#059669', titleKey: 'staff.chart_purchases', icon: 'fa-shopping-cart' },
  { key: 'debt', color: 'green', chartColor: '#059669', titleKey: 'staff.chart_debt', icon: 'fa-hand-holding-usd' },
  { key: 'expenses', color: 'green', chartColor: '#059669', titleKey: 'staff.chart_expenses', icon: 'fa-receipt' },
];

// Green shades from darkest (highest value) to lightest (lowest value),
// so bars in a chart are differentiated purely by intensity.
const GREEN_SHADES = ['#065f46', '#047857', '#059669', '#10b981', '#34d399', '#6ee7b7'];
function greenByRatio(ratio) {
  const idx = Math.min(GREEN_SHADES.length - 1, Math.round((1 - ratio) * (GREEN_SHADES.length - 1)));
  return GREEN_SHADES[idx];
}

function StaffActivityChart({ title, data, chartColor, index = 0 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 anim-fade-up" style={{ animationDelay: `${index * 90}ms` }}>
          <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
           <span className="w-2.5 h-2.5 rounded-full" style={{ background: chartColor }}></span>{title}
         </h4>
         <p className="text-xs text-gray-400 py-6 text-center">—</p>
      </div>
    );
  }
  const rowH = 30;
  const labelW = 92;
  const valW = 34;
  const barAreaW = 200;
  const h = data.length * rowH + 16;
  const w = labelW + barAreaW + valW;
  return (
    <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 anim-fade-up" style={{ animationDelay: `${index * 90}ms` }}>
        <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: chartColor }}></span>{title}
        </h4>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="min-w-[280px]" role="img">
          {data.map((d, i) => {
            const y = 8 + i * rowH;
            const bw = Math.max(2, (d.value / max) * barAreaW);
            const isHover = hover === i;
            return (
              <g
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: 'default' }}
              >
                <rect x={0} y={y} width={w} height={rowH} fill={isHover ? '#f3f4f6' : 'transparent'} rx="4" />
                <text x={i === 0 ? 14 : 0} y={y + rowH / 2} dominantBaseline="middle" fontSize="11" fill={isHover ? '#111827' : (i === 0 ? '#111827' : '#6b7280')} fontWeight={isHover || i === 0 ? '600' : '400'}>{d.label}</text>
                {i === 0 && <text x={0} y={y + rowH / 2} dominantBaseline="middle" fontSize="10" fill="#d97706">★</text>}
                <rect
                  x={labelW}
                  y={y + 4}
                  width={bw}
                  height={rowH - 12}
                  rx="4"
                  fill={isHover ? '#065f46' : greenByRatio(d.value / max)}
                  className="anim-grow-bar"
                  style={{ animationDelay: `${i * 80}ms`, transition: 'width 0.2s ease, fill 0.15s ease' }}
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </rect>
                <text x={labelW + barAreaW + 6} y={y + rowH / 2} dominantBaseline="middle" fontSize="11" fontWeight="600" fill="#111827">{d.value}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {hover !== null && (
        <div className="absolute top-2 right-2 bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-none z-10">
          <span className="font-semibold">{data[hover].label}</span>
          <span className="opacity-80"> · {data[hover].value} {data[hover].value === 1 ? 'record' : 'records'}</span>
        </div>
      )}
    </div>
  );
}

function StaffAnalytics({ staff, ownerCounts, t }) {
  const people = [
    ...staff.map((s) => ({ name: s.name, counts: s.counts || { orders: 0, products: 0, purchases: 0, debt: 0, expenses: 0 } })),
    ...(ownerCounts ? [{ name: t('staff.analytics_owner'), counts: ownerCounts }] : []),
  ];
  const charts = CHART_META.map((m) => ({
    ...m,
    data: [...people]
      .map((p) => ({ label: p.name, value: p.counts[m.key] || 0 }))
      .sort((a, b) => b.value - a.value),
  }));

  const topCards = CHART_META.map((m) => {
    const sorted = [...people].map((p) => ({ name: p.name, value: p.counts[m.key] || 0 })).sort((a, b) => b.value - a.value);
    const top = sorted[0] && sorted[0].value > 0 ? sorted[0] : null;
    return { ...m, top };
  });

  return (
    <div className="mb-6">
      <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <i className="fas fa-chart-bar text-primary-600"></i> {t('staff.analytics_title')}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {topCards.map((c, i) => (
          <div key={c.key} className="anim-fade-up" style={{ animationDelay: `${i * 80}ms` }}>
            <StatCard
              icon={c.icon}
              color={c.color}
              title={t(c.titleKey)}
              subtitle={c.top ? `${c.top.name} · ${c.top.value} ${t('staff.top_records')}` : '—'}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {charts.map((c, i) => (
          <StaffActivityChart key={c.key} title={t(c.titleKey)} data={c.data} chartColor={c.chartColor} index={i} />
        ))}
      </div>
    </div>
  );
}

function StaffAnalyticsSkeleton() {
  return (
    <div className="mb-6">
      <div className="h-5 w-56 rounded skeleton-shimmer mb-3"></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl skeleton-shimmer"></div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl skeleton-shimmer"></div>
        ))}
      </div>
    </div>
  );
}
