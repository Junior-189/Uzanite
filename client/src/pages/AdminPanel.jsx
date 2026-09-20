import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import { fetchCached, clearCache } from '../utils/cache';
import db from '../db';
import SearchInput from '../components/SearchInput';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import { setAccessToken, setUser as setStoredUser, stashAdminSession } from '../utils/tokenStore';

export default function AdminPanel() {
  const { user } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showResetPw, setShowResetPw] = useState(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [showEditName, setShowEditName] = useState(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [showEditEmail, setShowEditEmail] = useState(null);
  const [editEmailValue, setEditEmailValue] = useState('');
  const [showReject, setShowReject] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [activeTab, setActiveTab] = useState('tenants');
  const [subAdmins, setSubAdmins] = useState([]);
  const [subAdminPerms, setSubAdminPerms] = useState({});
  const [showCreateSubAdmin, setShowCreateSubAdmin] = useState(false);
  const [newSubAdmin, setNewSubAdmin] = useState({ name: '', email: '', password: '', permissions: [] });
  const [showEditSubAdmin, setShowEditSubAdmin] = useState(null);
  const [editSubAdmin, setEditSubAdmin] = useState({ name: '', email: '', permissions: [] });
  const [showResetSubAdminPw, setShowResetSubAdminPw] = useState(null);
  const [resetSubAdminPw, setResetSubAdminPw] = useState('');

  // ── Feature Control (global + per-tenant) ──
  const [globalFlags, setGlobalFlags] = useState({});
  const [flagFeatures, setFlagFeatures] = useState([]);
  const [flagTenantId, setFlagTenantId] = useState('');
  const [flagTenantOverrides, setFlagTenantOverrides] = useState({});
  const [flagLoading, setFlagLoading] = useState(false);
  const [flagSaving, setFlagSaving] = useState(false);

  const fetchFeatureFlags = useCallback(async () => {
    setFlagLoading(true);
    try {
      const res = await api.get('/admin/feature-flags' + (flagTenantId ? `?tenantId=${flagTenantId}` : ''));
      if (res.success) {
        setFlagFeatures(res.features || []);
        setGlobalFlags(res.global || {});
      }
    } catch {}
    finally { setFlagLoading(false); }
  }, [flagTenantId]);

  useEffect(() => {
    if (activeTab === 'features') fetchFeatureFlags();
  }, [activeTab, fetchFeatureFlags]);

  const saveGlobalFlags = async () => {
    setFlagSaving(true);
    try {
      const res = await api.put('/admin/feature-flags', { flags: globalFlags });
      if (res.success) {
        setGlobalFlags(res.global || {});
        showToast(t('feature.saved'), 'success');
      }
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    } finally { setFlagSaving(false); }
  };

  const toggleGlobalFlag = (key) => {
    setGlobalFlags(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { enabled: true, message: '' }), enabled: !(prev[key]?.enabled !== false) },
    }));
  };

  const setGlobalMessage = (key, message) => {
    setGlobalFlags(prev => ({
      ...prev,
      [key]: { ...(prev[key] || { enabled: true, message: '' }), message },
    }));
  };

  const saveTenantFlags = async () => {
    if (!flagTenantId) return;
    setFlagSaving(true);
    try {
      const res = await api.put(`/admin/feature-flags/${flagTenantId}`, { flags: flagTenantOverrides });
      if (res.success) {
        showToast(t('feature.tenant_saved'), 'success');
        fetchFeatureFlags();
      }
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    } finally { setFlagSaving(false); }
  };

  const resetTenantFlags = async () => {
    if (!flagTenantId) return;
    if (!confirm(t('feature.confirm_reset_tenant'))) return;
    setFlagSaving(true);
    try {
      const res = await api.delete(`/admin/feature-flags/${flagTenantId}`);
      if (res.success) {
        setFlagTenantOverrides({});
        showToast(t('feature.tenant_reset'), 'success');
        fetchFeatureFlags();
      }
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    } finally { setFlagSaving(false); }
  };

  const toggleTenantFlag = (key) => {
    const base = flagTenantOverrides[key] || globalFlags[key] || { enabled: true, message: '' };
    setFlagTenantOverrides(prev => ({
      ...prev,
      [key]: { ...base, enabled: !(base.enabled !== false) },
    }));
  };

  const setTenantMessage = (key, message) => {
    const base = flagTenantOverrides[key] || globalFlags[key] || { enabled: true, message: '' };
    setFlagTenantOverrides(prev => ({
      ...prev,
      [key]: { ...base, message },
    }));
  };

  useEffect(() => {
    if (user?.role === 'super_admin' || user?.role === 'sub_admin') {
      fetchAll();
      if (user?.role === 'super_admin') fetchSubAdmins();
    }
  }, [user]);

  const fetchSubAdmins = useCallback(async () => {
    try {
      clearCache('sub-admins');
      const res = await fetchCached('sub-admins', () => api.get('/admin/sub-admins'));
      if (res.success) {
        setSubAdmins(res.users || []);
        setSubAdminPerms(res.permissions || {});
      }
    } catch {}
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      clearCache('admin-users');
      clearCache('admin-stats');
      const [usersRes, statsRes] = await Promise.all([
        fetchCached('admin-users', () => api.get('/admin/users')),
        fetchCached('admin-stats', () => api.get('/admin/stats')),
      ]);
      if (usersRes.success) setUsers(usersRes.users || []);
      if (statsRes.success) setStats(statsRes.stats);
    } catch {
      showToast(t('admin_panel.failed_to_load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const handleApprove = async (id, name) => {
    if (!confirm(t('admin_panel.confirm_approve', { name }))) return;
    try {
      await api.put(`/admin/users/${id}/approve`);
      showToast(t('admin_panel.confirmed_approve'), 'success');
      fetchAll();
    } catch {
      showToast(t('common.error'), 'error');
    }
  };

  const handleReject = (u) => {
    setShowReject(u);
    setRejectReason('');
  };

  const confirmReject = async () => {
    if (!showReject) return;
    const reason = rejectReason.trim() || t('admin_panel.reject_default_reason');
    try {
      await api.put(`/admin/users/${showReject._id}/reject`, { reason });
      showToast(t('admin_panel.confirmed_rejected'), 'success');
      setShowReject(null);
      setRejectReason('');
      fetchAll();
    } catch {
      showToast(t('common.error'), 'error');
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(t('admin_panel.confirm_delete', { name }))) return;
    try {
      await api.delete(`/admin/users/${id}`);
      showToast(t('admin_panel.confirmed_deleted'), 'success');
      fetchAll();
    } catch {
      showToast(t('common.error'), 'error');
    }
  };

  const handleImpersonate = async (id, name) => {
    if (!confirm(t('admin_panel.confirm_impersonate', { name }))) return;
    try {
      const res = await api.post(`/admin/impersonate/${id}`);
      if (res.success) {
        try { await db.dashboardCache.clear(); } catch {}
        // Stash the admin's own session so they can exit impersonation. The
        // admin's token stays in memory rather than being written to storage.
        stashAdminSession();
        setAccessToken(res.token);
        // Save sub-admin's tenant page permissions for impersonation enforcement
        const subAdminPagePerms = (user?.permissions || []).filter(p =>
          ['view_dashboard','manage_orders','manage_products','manage_contacts','manage_whatsapp','manage_broadcast','manage_expenses','manage_purchases','manage_debts','manage_staff','manage_business','manage_settings','manage_notifications','view_reports','access_recycle_bin'].includes(p)
        );
        const userData = { ...res.user, impersonating: true };
        if (user?.role === 'sub_admin' && subAdminPagePerms.length > 0) {
          userData.impersonatorPermissions = subAdminPagePerms;
        }
        setStoredUser(userData);
        window.location.href = '/admin/dashboard';
      }
    } catch {
      showToast(t('common.error'), 'error');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!showResetPw || !resetPwValue) return;
    try {
      await api.put(`/admin/users/${showResetPw._id}/reset-password`, {
        newPassword: resetPwValue,
      });
      showToast(t('admin_panel.confirmed_reset_password'), 'success');
      setShowResetPw(null);
      setResetPwValue('');
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleEditName = async (e) => {
    e.preventDefault();
    if (!showEditName || !editNameValue.trim()) return;
    try {
      await api.put(`/admin/users/${showEditName._id}/update-name`, {
        name: editNameValue.trim(),
      });
      showToast(t('admin_panel.confirmed_name_updated'), 'success');
      setShowEditName(null);
      setEditNameValue('');
      fetchAll();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleEditEmail = async (e) => {
    e.preventDefault();
    if (!showEditEmail || !editEmailValue.trim()) return;
    try {
      await api.put(`/admin/users/${showEditEmail._id}/update-email`, {
        email: editEmailValue.trim(),
      });
      showToast(t('admin_panel.confirmed_email_updated'), 'success');
      setShowEditEmail(null);
      setEditEmailValue('');
      fetchAll();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleSuspend = async (id, name, currentSuspended) => {
    if (!confirm(currentSuspended ? t('admin_panel.confirm_unsuspend', { name }) : t('admin_panel.confirm_suspend', { name }))) return;
    try {
      await api.put(`/admin/users/${id}/suspend`, { suspended: !currentSuspended });
      showToast(t('admin_panel.confirmed_suspend'), 'success');
      fetchAll();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleSuspendSubAdmin = async (id, name, currentSuspended) => {
    if (!confirm(currentSuspended ? t('admin_panel.confirm_unsuspend', { name }) : t('admin_panel.confirm_suspend', { name }))) return;
    try {
      await api.put(`/admin/users/${id}/suspend`, { suspended: !currentSuspended });
      showToast(t('admin_panel.confirmed_suspend'), 'success');
      fetchSubAdmins();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleCreateSubAdmin = async (e) => {
    e.preventDefault();
    if (!newSubAdmin.name || !newSubAdmin.email || !newSubAdmin.password) return;
    try {
      await api.post('/admin/sub-admins', newSubAdmin);
      showToast(t('admin_panel.sub_admin_created'), 'success');
      setShowCreateSubAdmin(false);
      setNewSubAdmin({ name: '', email: '', password: '', permissions: [] });
      fetchSubAdmins();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleUpdateSubAdmin = async (e) => {
    e.preventDefault();
    if (!showEditSubAdmin) return;
    try {
      await api.put(`/admin/sub-admins/${showEditSubAdmin._id}`, editSubAdmin);
      showToast(t('admin_panel.sub_admin_updated'), 'success');
      setShowEditSubAdmin(null);
      setEditSubAdmin({ name: '', email: '', permissions: [] });
      fetchSubAdmins();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleDeleteSubAdmin = async (id, name) => {
    if (!confirm(t('admin_panel.confirm_delete_sub_admin', { name }))) return;
    try {
      await api.delete(`/admin/sub-admins/${id}`);
      showToast(t('admin_panel.confirmed_deleted'), 'success');
      fetchSubAdmins();
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const handleResetSubAdminPw = async (e) => {
    e.preventDefault();
    if (!showResetSubAdminPw || !resetSubAdminPw) return;
    try {
      await api.put(`/admin/sub-admins/${showResetSubAdminPw._id}/reset-password`, { newPassword: resetSubAdminPw });
      showToast(t('admin_panel.confirmed_reset_password'), 'success');
      setShowResetSubAdminPw(null);
      setResetSubAdminPw('');
    } catch (err) {
      showToast(err.error || t('common.error'), 'error');
    }
  };

  const toggleSubAdminPerm = (perm, isEdit = false) => {
    if (isEdit) {
      setEditSubAdmin(prev => ({
        ...prev,
        permissions: prev.permissions.includes(perm)
          ? prev.permissions.filter(p => p !== perm)
          : [...prev.permissions, perm],
      }));
    } else {
      setNewSubAdmin(prev => ({
        ...prev,
        permissions: prev.permissions.includes(perm)
          ? prev.permissions.filter(p => p !== perm)
          : [...prev.permissions, perm],
      }));
    }
  };

  const filtered = users.filter((u) => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        (u.name || '').toLowerCase().includes(s) ||
        (u.email || '').toLowerCase().includes(s) ||
        (u.businessName || '').toLowerCase().includes(s)
      );
    }
    return true;
  });

  const isSuperAdmin = user?.role === 'super_admin';
  const hasPerm = (perm) => isSuperAdmin || (user?.permissions || []).includes(perm);

  if (user?.role === 'sub_admin' && !(user?.permissions || []).includes('view_tenants')) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <div className="w-16 h-16 bg-danger-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-shield-alt text-2xl text-danger-600"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('admin_panel.access_denied')}</h3>
        <p className="text-sm text-gray-500">{t('admin_panel.no_manage_tenants')}</p>
      </div>
    );
  }
  if (user?.role !== 'super_admin' && user?.role !== 'sub_admin') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <div className="w-16 h-16 bg-danger-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-shield-alt text-2xl text-danger-600"></i>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('admin_panel.access_denied')}</h3>
        <p className="text-sm text-gray-500">{t('admin_panel.super_admin_only')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-shield-alt text-primary-600 mr-2"></i> {t('admin_panel.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('admin_panel.subtitle')}</p>
        </div>
        <button
          className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          onClick={fetchAll}
        >
          <i className="fas fa-sync-alt"></i> {t('admin_panel.refresh')}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
          <StatCard icon="users" color="blue" value={stats.totalUsers || 0} label={t('admin_panel.total_tenants')} />
          <StatCard icon="clock" color="yellow" value={stats.pendingUsers || 0} label={t('admin_panel.pending')} />
          <StatCard icon="check" color="green" value={stats.approvedUsers || 0} label={t('admin_panel.approved')} />
          <StatCard icon="times" color="red" value={stats.rejectedUsers || 0} label={t('admin_panel.rejected')} />
          <StatCard
            icon="fab fa-whatsapp"
            color="green"
            value={stats.connectedWhatsApp || 0}
            label={t('admin_panel.wa_connected')}
          />
        </div>
      )}

      {/* ── Tenant Modals (always rendered) ──────────────────────── */}
      <Modal
        open={!!showResetPw}
        onClose={() => { setShowResetPw(null); setResetPwValue(''); }}
        title={t('admin_panel.reset_pw_title', { name: showResetPw?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => { setShowResetPw(null); setResetPwValue(''); }}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleResetPassword}>{t('common.save')}</button>
          </>
        }
      >
        <form onSubmit={handleResetPassword}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin_panel.new_password')}</label>
          <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="password" value={resetPwValue} onChange={e => setResetPwValue(e.target.value)} required minLength={6} />
        </form>
      </Modal>

      <Modal
        open={!!showEditName}
        onClose={() => { setShowEditName(null); setEditNameValue(''); }}
        title={t('admin_panel.edit_name_title', { name: showEditName?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => { setShowEditName(null); setEditNameValue(''); }}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleEditName}>{t('common.save')}</button>
          </>
        }
      >
        <form onSubmit={handleEditName}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin_panel.new_name')}</label>
          <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="text" value={editNameValue} onChange={e => setEditNameValue(e.target.value)} required minLength={2} />
        </form>
      </Modal>

      <Modal
        open={!!showEditEmail}
        onClose={() => { setShowEditEmail(null); setEditEmailValue(''); }}
        title={t('admin_panel.edit_email_title', { name: showEditEmail?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => { setShowEditEmail(null); setEditEmailValue(''); }}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleEditEmail}>{t('common.save')}</button>
          </>
        }
      >
        <form onSubmit={handleEditEmail}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin_panel.new_email')}</label>
          <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="email" value={editEmailValue} onChange={e => setEditEmailValue(e.target.value)} required />
        </form>
      </Modal>

      <Modal
        open={!!showReject}
        onClose={() => { setShowReject(null); setRejectReason(''); }}
        title={t('admin_panel.reject_title', { name: showReject?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => { setShowReject(null); setRejectReason(''); }}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-danger-600 text-white hover:bg-danger-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={confirmReject}>{t('admin_panel.reject')}</button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); confirmReject(); }}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin_panel.reject_reason_label')}</label>
          <textarea
            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors resize-none"
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('admin_panel.reject_reason_placeholder')}
          />
          <p className="text-xs text-gray-400 mt-1.5">{t('admin_panel.reject_reason_hint')}</p>
        </form>
      </Modal>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-6 border-b border-gray-200 pb-0">
        {[
          { id: 'tenants', icon: 'fas fa-users', label: t('admin_panel.tab_tenants') },
          ...(user?.role === 'super_admin' ? [{ id: 'subadmins', icon: 'fas fa-user-shield', label: t('admin_panel.tab_sub_admins') }] : []),
          ...(user?.role === 'super_admin' || (user?.permissions || []).includes('view_tenants') ? [{ id: 'features', icon: 'fas fa-sliders-h', label: t('feature.tab') }] : []),
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className={tab.icon}></i> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tenants Tab ──────────────────────────────────────────── */}
      {activeTab === 'tenants' && (
        <div>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={t('admin_panel.search_tenants')}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <button
              key={s}
              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:text-primary-600'
              }`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? t('common.all') : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-users text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('admin_panel.no_tenants')}</h3>
          <p className="text-sm text-gray-500">{t('admin_panel.no_tenants_hint')}</p>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_name')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_email')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_business')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_role')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('common.status')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('admin_panel.col_orders')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('admin_panel.col_revenue')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('common.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u._id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                      {u.name}
                      {u.suspended && (
                        <span className="ml-1.5 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-danger-100 text-danger-700 font-bold uppercase">
                          {t('admin_panel.suspended')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{u.email}</td>
                    <td className="px-5 py-3 text-xs text-gray-600">{u.businessName || '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={u.role === 'super_admin' ? 'active' : 'pending'}>
                        {u.role}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-900">{u.totalOrders || 0}</td>
                    <td className="px-5 py-3 text-sm text-gray-900">
                      {(u.totalRevenue || 0).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {u.status === 'pending' && hasPerm('approve_tenants') && (
                          <>
                            <button
                              className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-success-600 text-white hover:bg-success-700 transition-colors"
                              onClick={() => handleApprove(u._id, u.name)}
                              title={t('admin_panel.approve')}
                            >
                              <i className="fas fa-check"></i>
                            </button>
                            <button
                              className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors"
                              onClick={() => handleReject(u)}
                              title={t('admin_panel.reject')}
                            >
                              <i className="fas fa-times"></i>
                            </button>
                          </>
                        )}
                        {u.status === 'approved' && u.role !== 'super_admin' && hasPerm('impersonate_tenants') && (
                          <button
                            className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                            title={t('admin_panel.impersonate')}
                            onClick={() => handleImpersonate(u._id, u.name)}
                          >
                            <i className="fas fa-eye"></i>
                          </button>
                        )}
                        {u.role !== 'super_admin' && hasPerm('edit_tenants') && (
                          <button
                            className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                            title={t('admin_panel.edit_name')}
                            onClick={() => {
                              setShowEditName(u);
                              setEditNameValue(u.name);
                            }}
                          >
                            <i className="fas fa-pen"></i>
                          </button>
                        )}
                        {u.role !== 'super_admin' && hasPerm('edit_tenants') && (
                          <button
                            className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                            title={t('admin_panel.edit_email')}
                            onClick={() => {
                              setShowEditEmail(u);
                              setEditEmailValue(u.email);
                            }}
                          >
                            <i className="fas fa-envelope"></i>
                          </button>
                        )}
                        {u.role !== 'super_admin' && hasPerm('suspend_tenants') && (
                          <button
                            className={`inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                              u.suspended
                                ? 'bg-warning-600 text-white hover:bg-warning-700'
                                : 'bg-white text-warning-700 border border-warning-300 hover:bg-warning-50'
                            }`}
                            title={u.suspended ? t('admin_panel.unsuspend') : t('admin_panel.suspend')}
                            onClick={() => handleSuspend(u._id, u.name, u.suspended)}
                          >
                            <i className={`fas ${u.suspended ? 'fa-play' : 'fa-ban'}`}></i>
                          </button>
                        )}
                        {hasPerm('reset_tenant_passwords') && (
                        <button
                          className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                          title={t('admin_panel.reset_password')}
                          onClick={() => {
                            setShowResetPw(u);
                            setResetPwValue('');
                          }}
                        >
                          <i className="fas fa-key"></i>
                        </button>
                        )}
                        {hasPerm('delete_tenants') && (
                        <button
                          className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors"
                          title={t('common.delete')}
                          onClick={() => handleDelete(u._id, u.name)}
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Mobile Cards */}
        <div className="md:hidden space-y-3">
          {filtered.map((u) => (
            <div key={u._id} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${u.suspended ? 'border-l-4 border-l-danger-400' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-900">{u.name}</span>
                <div className="flex gap-1.5">
                  <StatusBadge status={u.role === 'super_admin' ? 'active' : 'pending'}>{u.role}</StatusBadge>
                  <StatusBadge status={u.status} />
                </div>
              </div>
              <div className="text-xs text-gray-400 mb-1">{u.email}</div>
              <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                {u.businessName && <span>{u.businessName}</span>}
                <span>{t('admin_panel.col_orders')}: {u.totalOrders || 0}</span>
                <span>{t('admin_panel.col_revenue')}: {(u.totalRevenue || 0).toLocaleString()}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-gray-100">
                {u.status === 'pending' && hasPerm('approve_tenants') && (
                  <>
                    <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-success-600 text-white" onClick={() => handleApprove(u._id, u.name)}>{t('admin_panel.approve')}</button>
                    <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white" onClick={() => handleReject(u)}>{t('admin_panel.reject')}</button>
                  </>
                )}
                {u.status === 'approved' && u.role !== 'super_admin' && hasPerm('impersonate_tenants') && (
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300" onClick={() => handleImpersonate(u._id, u.name)}>{t('admin_panel.view')}</button>
                )}
                {u.role !== 'super_admin' && hasPerm('edit_tenants') && (
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300" onClick={() => { setShowEditName(u); setEditNameValue(u.name); }}>{t('common.edit')}</button>
                )}
                {u.role !== 'super_admin' && hasPerm('suspend_tenants') && (
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300" onClick={() => handleSuspend(u._id, u.name, !!u.suspended)}>{u.suspended ? t('admin_panel.unsuspend') : t('admin_panel.suspend')}</button>
                )}
                {u.role !== 'super_admin' && hasPerm('delete_tenants') && (
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white ml-auto" onClick={() => handleDelete(u._id, u.name)}>{t('common.delete')}</button>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
        )}
        </div>
      )}

      {/* ── Sub-Admins Tab ───────────────────────────────────────── */}
      {activeTab === 'subadmins' && (
        <>
          <div className="flex justify-end mb-4">
            <button
              className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
              onClick={() => { setShowCreateSubAdmin(true); setNewSubAdmin({ name: '', email: '', password: '', permissions: [] }); }}
            >
              <i className="fas fa-plus"></i> {t('admin_panel.add_sub_admin')}
            </button>
          </div>

          {subAdmins.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-user-shield text-2xl text-gray-400"></i>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('admin_panel.no_sub_admins')}</h3>
              <p className="text-sm text-gray-500">{t('admin_panel.no_sub_admins_hint')}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50/50">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_name')}</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_email')}</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('admin_panel.col_permissions')}</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subAdmins.map(sa => (
                      <tr key={sa._id} className={`border-b border-gray-50 last:border-0 transition-colors ${sa.suspended ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}`}>
                        <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                          {sa.name}
                          {sa.suspended && (
                            <span className="ml-1.5 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-danger-100 text-danger-700 font-bold uppercase">
                              {t('admin_panel.suspended')}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">{sa.email}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(sa.permissions || []).map(p => (
                              <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                                {subAdminPerms[p] || p}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex gap-1 flex-wrap">
                            <button
                              className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                              title={t('common.edit')}
                              onClick={() => {
                                setShowEditSubAdmin(sa);
                                setEditSubAdmin({ name: sa.name, email: sa.email, permissions: sa.permissions || [] });
                              }}
                            >
                              <i className="fas fa-pen"></i>
                            </button>
                            <button
                              className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
                              title={t('admin_panel.reset_password')}
                              onClick={() => { setShowResetSubAdminPw(sa); setResetSubAdminPw(''); }}
                            >
                              <i className="fas fa-key"></i>
                            </button>
                            <button
                              className={`inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                                sa.suspended
                                  ? 'bg-warning-600 text-white hover:bg-warning-700'
                                  : 'bg-white text-warning-700 border border-warning-300 hover:bg-warning-50'
                              }`}
                              title={sa.suspended ? t('admin_panel.unsuspend') : t('admin_panel.suspend')}
                              onClick={() => handleSuspendSubAdmin(sa._id, sa.name, sa.suspended)}
                            >
                              <i className={`fas ${sa.suspended ? 'fa-play' : 'fa-ban'}`}></i>
                            </button>
                            <button
                              className="inline-flex items-center text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors"
                              title={t('common.delete')}
                              onClick={() => handleDeleteSubAdmin(sa._id, sa.name)}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile Cards */}
              <div className="md:hidden space-y-3 p-3">
                {subAdmins.map(sa => (
                  <div key={sa._id} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${sa.suspended ? 'border-l-4 border-l-danger-400' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-gray-900">{sa.name}</span>
                      {sa.suspended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger-100 text-danger-700 font-bold">{t('admin_panel.suspended')}</span>}
                    </div>
                    <div className="text-xs text-gray-400 mb-1">{sa.email}</div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {(sa.permissions || []).map(p => (
                        <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">{subAdminPerms[p] || p}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
                      <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300" onClick={() => { setShowEditSubAdmin(sa); setEditSubAdmin({ name: sa.name, email: sa.email, permissions: sa.permissions || [] }); }}>{t('common.edit')}</button>
                      <button className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${sa.suspended ? 'bg-warning-600 text-white' : 'bg-white text-warning-700 border border-warning-300'}`} onClick={() => handleSuspendSubAdmin(sa._id, sa.name, sa.suspended)}>{sa.suspended ? t('admin_panel.unsuspend') : t('admin_panel.suspend')}</button>
                      <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white ml-auto" onClick={() => handleDeleteSubAdmin(sa._id, sa.name)}>{t('common.delete')}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Feature Control Tab ─────────────────────────────────── */}
      {activeTab === 'features' && (
        <div className="space-y-6">
          {/* Global defaults */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <i className="fas fa-globe text-primary-600"></i> {t('feature.global_title')}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{t('feature.global_desc')}</p>
              </div>
              <button
                onClick={saveGlobalFlags}
                disabled={flagSaving}
                className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <i className="fas fa-save"></i> {t('feature.save_global')}
              </button>
            </div>
            <div className="divide-y divide-gray-50">
              {flagLoading ? (
                <div className="p-10 text-center text-sm text-gray-400"><div className="w-7 h-7 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto"></div></div>
              ) : flagFeatures.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">{t('feature.none')}</div>
              ) : flagFeatures.map((f) => {
                const g = globalFlags[f.key] || { enabled: true, message: '' };
                return (
                  <div key={f.key} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleGlobalFlag(f.key)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${g.enabled !== false ? 'bg-primary-600' : 'bg-gray-300'}`}
                          role="switch" aria-checked={g.enabled !== false}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${g.enabled !== false ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                        <span className="text-sm font-medium text-gray-900">{f.label}</span>
                      </div>
                    </div>
                    {g.enabled === false && (
                      <div className="mt-3 pl-14">
                        <input
                          className="w-full px-3.5 py-2 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                          value={g.message || ''}
                          onChange={(e) => setGlobalMessage(f.key, e.target.value)}
                          placeholder={t('feature.message_placeholder')}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-tenant overrides */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <i className="fas fa-user-cog text-primary-600"></i> {t('feature.tenant_title')}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{t('feature.tenant_desc')}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="px-3 py-2 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  value={flagTenantId}
                  onChange={(e) => setFlagTenantId(e.target.value)}
                >
                  <option value="">{t('feature.select_tenant')}</option>
                  {users.filter(u => u.role === 'tenant').map(u => (
                    <option key={u._id} value={u._id}>{u.name} ({u.email})</option>
                  ))}
                </select>
                <button
                  onClick={saveTenantFlags}
                  disabled={!flagTenantId || flagSaving}
                  className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-save"></i> {t('feature.save')}
                </button>
              </div>
            </div>
            {!flagTenantId ? (
              <div className="p-10 text-center text-sm text-gray-400">{t('feature.select_tenant_hint')}</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {flagFeatures.map((f) => {
                  const ov = flagTenantOverrides[f.key];
                  const base = globalFlags[f.key] || { enabled: true, message: '' };
                  const eff = ov || base;
                  return (
                    <div key={f.key} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            onClick={() => toggleTenantFlag(f.key)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${eff.enabled !== false ? 'bg-primary-600' : 'bg-gray-300'}`}
                            role="switch" aria-checked={eff.enabled !== false}
                          >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${eff.enabled !== false ? 'translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                          <span className="text-sm font-medium text-gray-900">{f.label}</span>
                          {ov ? (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning-100 text-warning-700">{t('feature.overridden')}</span>
                          ) : (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{t('feature.inherits')}</span>
                          )}
                        </div>
                        {ov && (
                          <button
                            onClick={() => setFlagTenantOverrides(prev => { const n = { ...prev }; delete n[f.key]; return n; })}
                            className="text-xs text-gray-400 hover:text-danger-600 transition-colors"
                            title={t('feature.clear_override')}
                          >
                            <i className="fas fa-undo"></i>
                          </button>
                        )}
                      </div>
                      {eff.enabled === false && (
                        <div className="mt-3 pl-14">
                          <input
                            className="w-full px-3.5 py-2 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                            value={eff.message || ''}
                            onChange={(e) => setTenantMessage(f.key, e.target.value)}
                            placeholder={t('feature.message_placeholder')}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-5 py-3 bg-gray-50/50">
                  <button
                    onClick={resetTenantFlags}
                    className="text-xs font-medium text-danger-600 hover:text-danger-700"
                  >
                    <i className="fas fa-undo mr-1"></i> {t('feature.reset_tenant')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create Sub-Admin Modal ─────────────────────────────── */}
      <Modal
        open={showCreateSubAdmin}
        onClose={() => setShowCreateSubAdmin(false)}
        title={t('admin_panel.create_sub_admin_title')}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => setShowCreateSubAdmin(false)}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleCreateSubAdmin}>{t('common.add')}</button>
          </>
        }
      >
        <form onSubmit={handleCreateSubAdmin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.name')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" value={newSubAdmin.name} onChange={e => setNewSubAdmin(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.email')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="email" value={newSubAdmin.email} onChange={e => setNewSubAdmin(p => ({ ...p, email: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.password')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="password" value={newSubAdmin.password} onChange={e => setNewSubAdmin(p => ({ ...p, password: e.target.value }))} required minLength={6} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('admin_panel.col_permissions')}</label>
            <div className="space-y-3">
              {/* Base: View Tenants (required for any tenant access) */}
              <div className="p-2.5 rounded-lg border bg-gray-50 border-gray-200">
                <label className={`flex items-center gap-2 cursor-pointer transition-colors ${newSubAdmin.permissions.includes('view_tenants') ? 'text-primary-700' : 'text-gray-600'}`}>
                  <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={newSubAdmin.permissions.includes('view_tenants')} onChange={() => toggleSubAdminPerm('view_tenants')} />
                  <span className="text-xs font-bold uppercase tracking-wide">{subAdminPerms['view_tenants'] || t('admin_panel.view_tenants')}</span>
                </label>
                <p className="text-[10px] text-gray-400 mt-1 ml-5">{t('admin_panel.view_tenants_hint')}</p>
              </div>

              {/* Tenant Management Actions */}
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t('admin_panel.tenant_actions')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(subAdminPerms).filter(([k]) => k !== 'view_tenants' && (k.startsWith('approve_') || k.startsWith('suspend_') || k.startsWith('impersonate_') || k.startsWith('edit_') || k.startsWith('reset_tenant') || k.startsWith('view_tenant') || k.startsWith('delete_'))).map(([key, label]) => (
                    <label key={key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${newSubAdmin.permissions.includes(key) ? 'bg-primary-50 border-primary-400 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={newSubAdmin.permissions.includes(key)} onChange={() => toggleSubAdminPerm(key)} />
                      <span className="text-xs font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Tenant Pages — only show when impersonate is allowed */}
              {newSubAdmin.permissions.includes('impersonate_tenants') && (
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t('admin_panel.tenant_pages')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(subAdminPerms).filter(([k]) => ['view_dashboard', 'manage_orders', 'manage_products', 'manage_contacts', 'manage_whatsapp', 'manage_broadcast', 'manage_expenses', 'manage_purchases', 'manage_debts', 'manage_staff', 'manage_business', 'manage_settings', 'manage_notifications', 'view_reports', 'access_recycle_bin'].includes(k)).map(([key, label]) => (
                    <label key={key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${newSubAdmin.permissions.includes(key) ? 'bg-primary-50 border-primary-400 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={newSubAdmin.permissions.includes(key)} onChange={() => toggleSubAdminPerm(key)} />
                      <span className="text-xs font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              )}
            </div>
          </div>
        </form>
      </Modal>

      {/* ── Edit Sub-Admin Modal ───────────────────────────────── */}
      <Modal
        open={!!showEditSubAdmin}
        onClose={() => setShowEditSubAdmin(null)}
        title={t('admin_panel.edit_sub_admin_title', { name: showEditSubAdmin?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => setShowEditSubAdmin(null)}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleUpdateSubAdmin}>{t('common.save')}</button>
          </>
        }
      >
        <form onSubmit={handleUpdateSubAdmin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.name')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" value={editSubAdmin.name} onChange={e => setEditSubAdmin(p => ({ ...p, name: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('common.email')}</label>
            <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="email" value={editSubAdmin.email} onChange={e => setEditSubAdmin(p => ({ ...p, email: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('admin_panel.col_permissions')}</label>
            <div className="space-y-3">
              {/* Base: View Tenants */}
              <div className="p-2.5 rounded-lg border bg-gray-50 border-gray-200">
                <label className={`flex items-center gap-2 cursor-pointer transition-colors ${editSubAdmin.permissions.includes('view_tenants') ? 'text-primary-700' : 'text-gray-600'}`}>
                  <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={editSubAdmin.permissions.includes('view_tenants')} onChange={() => toggleSubAdminPerm('view_tenants', true)} />
                  <span className="text-xs font-bold uppercase tracking-wide">{subAdminPerms['view_tenants'] || t('admin_panel.view_tenants')}</span>
                </label>
                <p className="text-[10px] text-gray-400 mt-1 ml-5">{t('admin_panel.view_tenants_hint')}</p>
              </div>

              {/* Tenant Actions */}
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t('admin_panel.tenant_actions')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(subAdminPerms).filter(([k]) => k !== 'view_tenants' && (k.startsWith('approve_') || k.startsWith('suspend_') || k.startsWith('impersonate_') || k.startsWith('edit_') || k.startsWith('reset_tenant') || k.startsWith('view_tenant') || k.startsWith('delete_'))).map(([key, label]) => (
                    <label key={key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${editSubAdmin.permissions.includes(key) ? 'bg-primary-50 border-primary-400 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={editSubAdmin.permissions.includes(key)} onChange={() => toggleSubAdminPerm(key, true)} />
                      <span className="text-xs font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Tenant Pages — only show when impersonate is allowed */}
              {editSubAdmin.permissions.includes('impersonate_tenants') && (
              <div>
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{t('admin_panel.tenant_pages')}</div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(subAdminPerms).filter(([k]) => ['view_dashboard', 'manage_orders', 'manage_products', 'manage_contacts', 'manage_whatsapp', 'manage_broadcast', 'manage_expenses', 'manage_purchases', 'manage_debts', 'manage_staff', 'manage_business', 'manage_settings', 'manage_notifications', 'view_reports', 'access_recycle_bin'].includes(k)).map(([key, label]) => (
                    <label key={key} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${editSubAdmin.permissions.includes(key) ? 'bg-primary-50 border-primary-400 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      <input type="checkbox" className="rounded border-gray-300 text-primary-600" checked={editSubAdmin.permissions.includes(key)} onChange={() => toggleSubAdminPerm(key, true)} />
                      <span className="text-xs font-medium">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              )}
            </div>
          </div>
        </form>
      </Modal>

      {/* ── Reset Sub-Admin Password Modal ─────────────────────── */}
      <Modal
        open={!!showResetSubAdminPw}
        onClose={() => { setShowResetSubAdminPw(null); setResetSubAdminPw(''); }}
        title={t('admin_panel.reset_pw_title', { name: showResetSubAdminPw?.name })}
        footer={
          <>
            <button className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => { setShowResetSubAdminPw(null); setResetSubAdminPw(''); }}>{t('common.cancel')}</button>
            <button className="inline-flex items-center gap-2 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={handleResetSubAdminPw}>{t('common.save')}</button>
          </>
        }
      >
        <form onSubmit={handleResetSubAdminPw}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('admin_panel.new_password')}</label>
          <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors" type="password" value={resetSubAdminPw} onChange={e => setResetSubAdminPw(e.target.value)} required minLength={6} />
        </form>
      </Modal>

    </div>
  );
}
