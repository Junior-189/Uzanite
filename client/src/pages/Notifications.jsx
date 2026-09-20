import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';

export default function Notifications() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications');
      if (res.success) setNotifications(res.notifications || []);
    } catch {
      showToast(t('common.failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await api.put('/notifications/read-all');
      showToast(t('notifications.confirmed_read'), 'success');
      fetchNotifications();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const clearAll = async () => {
    if (!confirm(t('notifications.confirm_clear'))) return;
    try {
      await api.delete('/notifications');
      showToast(t('notifications.confirmed_cleared'), 'success');
      fetchNotifications();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filtered = notifications.filter(
    (n) =>
      !search ||
      (n.title || '').toLowerCase().includes(search.toLowerCase()) ||
      (n.message || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('notifications.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('notifications.unread', { count: notifications.length, unread: unreadCount })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {unreadCount > 0 && (
            <button
              className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              onClick={markAllRead}
            >
              <i className="fas fa-check-double"></i> {t('notifications.mark_all_read')}
            </button>
          )}
          {notifications.length > 0 && (
            <button
              className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              onClick={clearAll}
            >
              <i className="fas fa-trash"></i> {t('notifications.clear_all')}
            </button>
          )}
          <button
            className="inline-flex items-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            onClick={fetchNotifications}
          >
            <i className="fas fa-sync-alt"></i> {t('common.refresh')}
          </button>
        </div>
      </div>

      <div className="mb-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('search.placeholder') || 'Search notifications...'}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-bell text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('notifications.no_notifications')}</h3>
          <p className="text-sm text-gray-500">{t('notifications.caught_up')}</p>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('notifications.col_title')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('notifications.col_message')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('notifications.col_type')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('notifications.col_priority')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">{t('notifications.col_date')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr
                    key={n._id}
                    className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors ${n.read ? 'opacity-60' : ''}`}
                  >
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">{n.title}</td>
                    <td className="px-5 py-3 text-sm text-gray-600 max-w-[300px] truncate">{n.message}</td>
                    <td className="px-5 py-3"><StatusBadge status="active">{n.type?.replace(/_/g, ' ')}</StatusBadge></td>
                    <td className="px-5 py-3"><StatusBadge status={n.priority === 'high' || n.priority === 'critical' ? 'rejected' : 'pending'}>{n.priority}</StatusBadge></td>
                    <td className="px-5 py-3 text-sm text-gray-600">{new Date(n.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Mobile Cards */}
        <div className="md:hidden space-y-3">
          {filtered.map((n) => (
            <div key={n._id} className={`bg-white rounded-xl shadow-sm border border-gray-100 p-4 ${n.read ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-900">{n.title}</span>
                <StatusBadge status={n.priority === 'high' || n.priority === 'critical' ? 'rejected' : 'pending'}>{n.priority}</StatusBadge>
              </div>
              <p className="text-xs text-gray-500 mb-2 line-clamp-2">{n.message}</p>
              <div className="flex items-center justify-between">
                <StatusBadge status="active">{n.type?.replace(/_/g, ' ')}</StatusBadge>
                <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
        </>
      )}

    </div>
  );
}
