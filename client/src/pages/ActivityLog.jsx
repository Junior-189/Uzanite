import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../context/LangContext';
import api from '../utils/api';
import { fetchCached, clearCache } from '../utils/cache';

export default function ActivityLog() {
  const { t } = useLang();
  const [tab, setTab] = useState('activity');
  const [activityLogs, setActivityLogs] = useState([]);
  const [loginAttempts, setLoginAttempts] = useState([]);
  const [activitySummary, setActivitySummary] = useState(null);
  const [loginSummary, setLoginSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loadedTabs, setLoadedTabs] = useState({});

  const fetchActivityLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (search) params.set('search', search);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const cacheKey = `activity-logs-${params.toString()}`;
      clearCache(cacheKey);
      const r = await fetchCached(cacheKey, () => api.get(`/admin/activity-logs?${params}`), 60000);
      if (r.success) { setActivityLogs(r.logs); setTotalPages(r.pages); }
    } catch {}
  }, [page, search, startDate, endDate]);

  const fetchLoginAttempts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page, limit: 30 });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('email', search);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const cacheKey = `login-attempts-${params.toString()}`;
      clearCache(cacheKey);
      const r = await fetchCached(cacheKey, () => api.get(`/admin/login-attempts?${params}`), 60000);
      if (r.success) { setLoginAttempts(r.attempts); setTotalPages(r.pages); }
    } catch {}
  }, [page, statusFilter, search, startDate, endDate]);

  const fetchSummaries = useCallback(async () => {
    try {
      clearCache('activity-summary');
      clearCache('login-summary');
      const [actRes, loginRes] = await Promise.all([
        fetchCached('activity-summary', () => api.get('/admin/activity-logs/summary'), 60000),
        fetchCached('login-summary', () => api.get('/admin/login-attempts/summary'), 60000),
      ]);
      if (actRes.success) setActivitySummary(actRes);
      if (loginRes.success) setLoginSummary(loginRes);
    } catch {}
  }, []);

  const fetchTabData = useCallback(async (tabName) => {
    setLoading(true);
    try {
      if (tabName === 'activity') await fetchActivityLogs();
      else if (tabName === 'logins') await fetchLoginAttempts();
      else if (tabName === 'devices') await fetchSummaries();
    } finally { setLoading(false); }
  }, [fetchActivityLogs, fetchLoginAttempts, fetchSummaries]);

  useEffect(() => { fetchTabData(tab); }, [fetchTabData, tab]);

  useEffect(() => { setPage(1); }, [tab, search, statusFilter, startDate, endDate]);
  useEffect(() => { if (tab === 'activity') fetchActivityLogs(); }, [page, fetchActivityLogs, tab]);

  const statusColor = (s) => {
    const m = { success: 'bg-emerald-100 text-emerald-700', failed: 'bg-red-100 text-red-700', pending: 'bg-amber-100 text-amber-700', rejected: 'bg-red-100 text-red-700', suspended: 'bg-orange-100 text-orange-700', inactive: 'bg-gray-100 text-gray-600', locked: 'bg-red-100 text-red-700' };
    return m[s] || 'bg-gray-100 text-gray-600';
  };

  const actionColor = (a) => {
    const m = { visit: 'bg-blue-100 text-blue-700', navigate: 'bg-purple-100 text-purple-700', leave: 'bg-gray-100 text-gray-600', create: 'bg-emerald-100 text-emerald-700', update: 'bg-amber-100 text-amber-700', delete: 'bg-red-100 text-red-700' };
    return m[a] || 'bg-gray-100 text-gray-600';
  };

  const fmtTime = (d) => new Date(d).toLocaleString();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('activity.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('activity.subtitle')}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">{t('activity.total_visits')}</div>
          <div className="text-2xl font-bold text-gray-900">{activitySummary?.totalVisits || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">{t('activity.today_visits')}</div>
          <div className="text-2xl font-bold text-blue-600">{activitySummary?.todayVisits || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">{t('activity.total_logins')}</div>
          <div className="text-2xl font-bold text-gray-900">{loginSummary?.totalAttempts || 0}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">{t('activity.failed_logins')}</div>
          <div className="text-2xl font-bold text-red-600">
            {loginSummary?.statusBreakdown?.find((s) => s._id === 'failed')?.count || 0}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex bg-gray-100 rounded-xl p-1 w-fit" role="tablist">
        {[
          { key: 'activity', label: t('activity.tab_activity') },
          { key: 'logins', label: t('activity.tab_logins') },
          { key: 'devices', label: t('activity.tab_devices') },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            role="tab"
            aria-selected={tab === item.key}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              tab === item.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tab === 'logins' ? t('activity.filter_email') : t('activity.filter_search')}
          className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
        />
        {tab === 'logins' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          >
            <option value="">{t('activity.all_status')}</option>
            <option value="success">{t('activity.status_success')}</option>
            <option value="failed">{t('activity.status_failed')}</option>
            <option value="pending">{t('activity.status_pending')}</option>
            <option value="rejected">{t('activity.status_rejected')}</option>
            <option value="suspended">{t('activity.status_suspended')}</option>
          </select>
        )}
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
      </div>

      {/* Activity Logs Tab */}
      {tab === 'activity' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_user')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_page')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_action')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_device')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_browser')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_time')}</th>
                </tr>
              </thead>
              <tbody>
                {activityLogs.map((log) => (
                  <tr key={log._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{log.userName || t('activity.guest')}</div>
                      <div className="text-xs text-gray-400">{log.userEmail || log.sessionId?.slice(0, 12)}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{log.page}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{log.device}</td>
                    <td className="px-4 py-3 text-gray-600">{log.browser}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtTime(log.createdAt)}</td>
                  </tr>
                ))}
                {activityLogs.length === 0 && (
                  <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-400">{t('activity.no_data')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {activityLogs.map((log) => (
              <div key={log._id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{log.userName || t('activity.guest')}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionColor(log.action)}`}>{log.action}</span>
                </div>
                <div className="text-xs text-gray-500 font-mono">{log.page}</div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{log.device}</span>·<span>{log.browser}</span>·<span>{log.os}</span>
                </div>
                <div className="text-xs text-gray-400">{fmtTime(log.createdAt)}</div>
              </div>
            ))}
            {activityLogs.length === 0 && <div className="p-8 text-center text-gray-400">{t('activity.no_data')}</div>}
          </div>
        </div>
      )}

      {/* Login Attempts Tab */}
      {tab === 'logins' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_email')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_user')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_role')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_status')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_reason')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_device')}</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">{t('activity.col_time')}</th>
                </tr>
              </thead>
              <tbody>
                {loginAttempts.map((a) => (
                  <tr key={a._id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.email}</td>
                    <td className="px-4 py-3 text-gray-700">{a.userName || '-'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-500 capitalize">{a.role || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(a.status)}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{a.reason || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{a.device} · {a.browser}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtTime(a.createdAt)}</td>
                  </tr>
                ))}
                {loginAttempts.length === 0 && (
                  <tr><td colSpan="7" className="px-4 py-8 text-center text-gray-400">{t('activity.no_data')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {loginAttempts.map((a) => (
              <div key={a._id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 text-sm">{a.email}</span>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(a.status)}`}>{a.status}</span>
                </div>
                {a.userName && <div className="text-xs text-gray-500">{a.userName} · {a.role}</div>}
                {a.reason && <div className="text-xs text-gray-400">{a.reason}</div>}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{a.device}</span>·<span>{a.browser}</span>·<span>{a.os}</span>
                </div>
                <div className="text-xs text-gray-400">{fmtTime(a.createdAt)}</div>
              </div>
            ))}
            {loginAttempts.length === 0 && <div className="p-8 text-center text-gray-400">{t('activity.no_data')}</div>}
          </div>
        </div>
      )}

      {/* Devices Tab */}
      {tab === 'devices' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('activity.device_breakdown')}</h3>
            <div className="space-y-3">
              {activitySummary?.deviceBreakdown?.map((d) => (
                <div key={d._id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{d._id}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: `${(d.count / (activitySummary?.totalVisits || 1)) * 100}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-12 text-right">{d.count}</span>
                  </div>
                </div>
              ))}
              {(!activitySummary?.deviceBreakdown || activitySummary.deviceBreakdown.length === 0) && (
                <div className="text-center text-gray-400 text-sm py-4">{t('activity.no_data')}</div>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('activity.browser_breakdown')}</h3>
            <div className="space-y-3">
              {activitySummary?.browserBreakdown?.map((b) => (
                <div key={b._id} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{b._id}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(b.count / (activitySummary?.totalVisits || 1)) * 100}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-12 text-right">{b.count}</span>
                  </div>
                </div>
              ))}
              {(!activitySummary?.browserBreakdown || activitySummary.browserBreakdown.length === 0) && (
                <div className="text-center text-gray-400 text-sm py-4">{t('activity.no_data')}</div>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 md:col-span-2">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('activity.top_pages')}</h3>
            <div className="space-y-2">
              {activitySummary?.topPages?.map((p, i) => (
                <div key={p._id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-6">{i + 1}</span>
                    <span className="text-sm text-gray-700 font-mono">{p._id}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-900">{p.count}</span>
                </div>
              ))}
              {(!activitySummary?.topPages || activitySummary.topPages.length === 0) && (
                <div className="text-center text-gray-400 text-sm py-4">{t('activity.no_data')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            {t('activity.prev')}
          </button>
          <span className="text-sm text-gray-500">{t('activity.page')} {page} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            {t('activity.next')}
          </button>
        </div>
      )}
    </div>
  );
}
