import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { useLoadMore } from '../hooks/useLoadMore';
import { fetchFromCacheOrApi, createOffline, deleteOffline } from '../db/helpers';
import api from '../utils/api';
import useOnlineStatus from '../hooks/useOnlineStatus';
import StatCard from '../components/StatCard';
import PeriodFilter from '../components/PeriodFilter';
import StatusBadge from '../components/StatusBadge';
import { KebabMenu, DetailModal } from '../components/TableDetail';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import { rowActivate } from '../utils/rowActivate';

export default function Expenses() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const [expenses, setExpenses] = useState([]);
  const { nextCursor, setNextCursor, loadMore, loadingMore } = useLoadMore('expenses', (items) =>
    setExpenses((prev) => [...prev, ...items])
  );
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editExp, setEditExp] = useState(null);
  const [form, setForm] = useState({ description: '', amount: '', category: 'Other', date: new Date().toISOString().split('T')[0] });
  const [period, setPeriod] = useState('alltime');
  const [showReportModal, setShowReportModal] = useState(false);
  const [detail, setDetail] = useState(null);

  const openDetail = (e) => setDetail(e);
  const expenseFields = (e) => ([
    { label: t('expenses.description'), value: e.description },
    { label: t('expenses.amount'), value: `${(e.amount || 0).toLocaleString()} TZS` },
    { label: t('expenses.category'), value: e.category || 'Other' },
    { label: t('expenses.date'), value: e.date ? new Date(e.date).toLocaleDateString() : '—' },
    { label: t('expenses.col_recorded_by'), value: e.recordedBy || 'Owner' },
    ...(e.notes ? [{ label: t('expenses.notes'), value: e.notes }] : []),
  ]);

  useEffect(() => { fetchExpenses(); }, []);

  const fetchExpenses = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const items = await fetchFromCacheOrApi('expenses', { forceRefresh });
      setExpenses(items);
      if (isOnline) {
        try {
          const res = await api.get('/expenses', { params: { limit: 50 } });
          if (res.success && Array.isArray(res.expenses)) { setExpenses(res.expenses); setNextCursor(res.nextCursor || null); }
        } catch { /* keep cached */ }
      }
    } catch { showToast(t('common.failed'), 'error'); } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editExp) { await deleteOffline('expenses', editExp._id || editExp.id); }
      await createOffline('expenses', { ...form, amount: Number(form.amount) });
      showToast(editExp ? t('expenses.confirmed_updated') : t('expenses.confirmed_added'), 'success');
      setShowForm(false); setEditExp(null);
      setForm({ description: '', amount: '', category: 'Other', date: new Date().toISOString().split('T')[0] });
      fetchExpenses(true);
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('expenses.delete_confirm'))) return;
    try { await deleteOffline('expenses', id); showToast(t('expenses.confirmed_deleted'), 'success'); fetchExpenses(true); } catch { showToast(t('common.failed'), 'error'); }
  };

  const filtered = expenses.filter((e) => {
    if (period !== 'alltime' && e.date) {
      const d = new Date(e.date);
      const now = new Date();
      if (period === 'daily' && d < new Date(now - 86400000)) return false;
      if (period === 'weekly' && d < new Date(now - 7 * 86400000)) return false;
      if (period === 'monthly' && d < new Date(now.getFullYear(), now.getMonth(), 1)) return false;
      if (period === 'annually' && d < new Date(now.getFullYear(), 0, 1)) return false;
    }
    return true;
  });

  const total = filtered.reduce((s, e) => s + (e.amount || 0), 0);
  const avgExpense = filtered.length > 0 ? Math.round(total / filtered.length) : 0;
  const categoryMap = [
    { value: 'Other', label: t('expenses.other') },
    { value: 'Utilities', label: t('expenses.cat_utilities') },
    { value: 'Rent', label: 'Rent' },
    { value: 'Salaries', label: t('expenses.cat_salaries') },
    { value: 'Transport', label: 'Transport' },
    { value: 'Marketing', label: t('expenses.cat_marketing') },
    { value: 'Supplies', label: t('expenses.cat_supplies') },
    { value: 'Maintenance', label: 'Maintenance' },
  ];
  const categoryCounts = {};
  filtered.forEach(e => { const c = e.category || 'Other'; categoryCounts[c] = (categoryCounts[c] || 0) + 1; });
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];

  const openEdit = (e) => {
    setEditExp(e);
    setForm({ description: e.description, amount: e.amount, category: e.category || 'Other', date: e.date ? new Date(e.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0] });
    setShowForm(true);
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-receipt mr-2 text-primary-600"></i>
            {t('expenses.title')}
          </h1>
          {!isOnline && (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200"><i className="fas fa-wifi-slash"></i> {t('common.offline')}</span>)}
          <p className="text-sm text-gray-500 mt-1">{expenses.length} {t('expenses.records_total', { total: total.toLocaleString() })}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => setShowReportModal(true)}>
            <i className="fas fa-file-pdf mr-1.5"></i> {t('expenses.report')}
          </button>
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { setEditExp(null); setForm({ description: '', amount: '', category: 'Other', date: new Date().toISOString().split('T')[0] }); setShowForm(true); }}>
            <i className="fas fa-plus mr-1.5"></i> {t('expenses.add')}
          </button>
        </div>
      </div>

      <PeriodFilter value={period} onChange={setPeriod} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="fa-receipt" color="pink" value={total.toLocaleString()} label={t('expenses.stat_total_spent')} />
        <StatCard icon="fa-calculator" color="orange" value={avgExpense.toLocaleString()} label={t('expenses.stat_avg_expense')} />
        <StatCard icon="fa-receipt" color="blue" value={expenses.length} label={t('expenses.stat_records')} />
        <StatCard icon="fa-tag" color="green" value={topCategory ? topCategory[0] : t('common.na')} label={t('expenses.stat_top_category')} />
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6 border-l-4 border-l-primary-500">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editExp ? t('expenses.edit_title') : t('expenses.add_title')}</h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('expenses.description')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('expenses.amount')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('expenses.category')}</label>
                <select className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categoryMap.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('expenses.date')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { setShowForm(false); setEditExp(null); }}>{t('common.cancel')}</button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">{editExp ? t('common.update') : t('expenses.save')}</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <i className="fas fa-receipt text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-medium text-gray-900">{t('expenses.empty')}</h3>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('expenses.description')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('expenses.amount')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('expenses.category')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('expenses.col_recorded_by')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('expenses.date')}</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e._id}
                    onClick={() => openDetail(e)}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{e.description}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-700">{(e.amount || 0).toLocaleString()}</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={e.category} />
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{e.recordedBy || 'Owner'}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <KebabMenu
                        t={t}
                        items={[
                          { label: t('common.view'), icon: 'fa-eye', cls: 'text-gray-700 hover:bg-gray-50', run: () => openDetail(e) },
                          { label: t('common.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(e) },
                          { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(e._id) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Mobile Cards */}
        <div className="md:hidden space-y-3">
          {filtered.map((e) => (
            <div key={e._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 cursor-pointer" {...rowActivate(() => openDetail(e))}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-900">{e.description}</span>
                <span className="text-sm font-bold text-gray-900">{(e.amount || 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <StatusBadge status={e.category} />
                <span className="text-xs text-gray-400">{new Date(e.date).toLocaleDateString()}</span>
              </div>
              <div className="text-xs text-gray-500 mb-3">
                <i className="fas fa-user mr-1 text-gray-400"></i>{t('expenses.col_recorded_by')}: <strong className="text-gray-700">{e.recordedBy || 'Owner'}</strong>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100" onClick={(ev) => ev.stopPropagation()}>
                <KebabMenu
                  t={t}
                  items={[
                    { label: t('common.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(e) },
                    { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(e._id) },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('expenses', 'expenses-report.pdf', p)} lang={lang} />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.description || t('expenses.title')}
        fields={detail ? expenseFields(detail) : []}
        footer={detail && (
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { const d = detail; setDetail(null); openEdit(d); }}>
            <i className="fas fa-pen mr-1.5"></i> {t('common.edit')}
          </button>
        )}
      />
      {nextCursor && (
        <div className="p-4 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 rounded-xl bg-white text-primary-700 border border-primary-200 text-sm font-semibold hover:bg-primary-50 disabled:opacity-50"
          >
            {loadingMore ? t('common.loading') : t('common.load_more')}
          </button>
        </div>
      )}
    </div>
  );
}
