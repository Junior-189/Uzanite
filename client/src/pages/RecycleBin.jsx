import { confirmDialog, promptDialog } from '../utils/dialog';
import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';

export default function RecycleBin() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const [data, setData] = useState({
    products: [],
    orders: [],
    contacts: [],
    notifications: [],
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('products');

  useEffect(() => {
    fetchDeleted();
  }, []);

  const fetchDeleted = async () => {
    setLoading(true);
    try {
      const res = await api.get('/recycle-bin');
      if (res.success) setData(res.data || {});
    } catch {
      showToast(t('common.failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (type, id) => {
    try {
      await api.post(`/recycle-bin/restore/${type}/${id}`);
      showToast(t('recycle_bin.confirmed_restored'), 'success');
      fetchDeleted();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const handlePermanentDelete = async (type, id) => {
    if (!(await confirmDialog(t('recycle_bin.confirm_permanent')))) return;
    try {
      await api.delete(`/recycle-bin/${type}/${id}`);
      showToast(t('recycle_bin.confirmed_deleted'), 'success');
      fetchDeleted();
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const items = data[tab] || [];
  const tabs = [
    { key: 'products', label: t('recycle_bin.tabs.products'), icon: 'fas fa-tag' },
    { key: 'orders', label: t('recycle_bin.tabs.orders'), icon: 'fas fa-clipboard-list' },
    { key: 'contacts', label: t('recycle_bin.tabs.contacts'), icon: 'fas fa-address-book' },
    {
      key: 'notifications',
      label: t('recycle_bin.tabs.notifications'),
      icon: 'fas fa-bell',
    },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-trash-restore text-primary-600 mr-2"></i>
            {t('recycle_bin.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('recycle_bin.desc')}</p>
        </div>
        <div className="flex items-center gap-3">
        </div>
      </div>


      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
              tab === tabItem.key
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:text-primary-600'
            }`}
            onClick={() => setTab(tabItem.key)}
          >
            <i className={tabItem.icon}></i> {tabItem.label}{' '}
            <span className="ml-0.5">({(data[tabItem.key] || []).length})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <i className="fas fa-trash-restore text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('recycle_bin.empty')}</h3>
          <p className="text-sm text-gray-500">{t('recycle_bin.no_items')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('recycle_bin.name_number')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('recycle_bin.details')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('recycle_bin.deleted_at')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">
                    {t('recycle_bin.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item._id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                      {item.name || item.orderNumber || item.title || 'N/A'}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {item.customer || item.phone || item.message || item.description || ''}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5">
                        <button
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium bg-success-600 text-white hover:bg-success-700 transition-colors"
                          onClick={() => handleRestore(tab, item._id)}
                        >
                          <i className="fas fa-undo"></i> {t('recycle_bin.restore')}
                        </button>
                        <button
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors"
                          onClick={() => handlePermanentDelete(tab, item._id)}
                        >
                          <i className="fas fa-trash"></i> {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
