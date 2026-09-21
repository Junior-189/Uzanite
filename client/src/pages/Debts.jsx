import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { useLoadMore } from '../hooks/useLoadMore';
import { fetchFromCacheOrApi, createOffline, updateOffline, deleteOffline, apiAction } from '../db/helpers';
import api from '../utils/api';
import useOnlineStatus from '../hooks/useOnlineStatus';
import StatCard from '../components/StatCard';
import SearchInput from '../components/SearchInput';
import StatusBadge from '../components/StatusBadge';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import { DetailModal } from '../components/TableDetail';
import { rowActivate } from '../utils/rowActivate';

export default function Debts() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const [debts, setDebts] = useState([]);
  const { nextCursor, setNextCursor, loadMore, loadingMore } = useLoadMore('debts', (items) =>
    setDebts((prev) => [...prev, ...items])
  );
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editDebt, setEditDebt] = useState(null);
  const [showPay, setShowPay] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [form, setForm] = useState({ customerName: '', customerPhone: '', amount: '', description: '', dueDate: '', notes: '' });
  const [showReportModal, setShowReportModal] = useState(false);
  const [detail, setDetail] = useState(null);

  const openDetail = (d) => setDetail(d);
  const debtFields = (d) => {
    const remaining = (d.amount || 0) - (d.paidAmount || 0);
    return [
      { label: t('debts.col_customer'), value: d.customerName },
      { label: t('debts.col_phone'), value: d.customerPhone || 'N/A' },
      { label: t('debts.col_amount'), value: `${(d.amount || 0).toLocaleString()} TZS` },
      { label: t('debts.col_paid'), value: `${(d.paidAmount || 0).toLocaleString()} TZS` },
      { label: t('debts.col_remaining'), value: `${remaining.toLocaleString()} TZS` },
      { label: t('debts.col_status'), value: d.status },
      { label: t('debts.col_due'), value: d.dueDate ? new Date(d.dueDate).toLocaleDateString() : '—' },
      { label: t('debts.col_recorded_by'), value: d.recordedBy || 'Owner' },
      ...(d.notes ? [{ label: t('debt.notes'), value: d.notes }] : []),
    ];
  };

  useEffect(() => { fetchDebts(); }, []);

  const fetchDebts = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const items = await fetchFromCacheOrApi('debts', { forceRefresh });
      setDebts(items);
      if (isOnline) {
        try {
          const res = await api.get('/debts', { params: { limit: 50 } });
          if (res.success && Array.isArray(res.debts)) { setDebts(res.debts); setNextCursor(res.nextCursor || null); }
        } catch { /* keep cached */ }
      }
    } catch { showToast(t('common.failed'), 'error'); } finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editDebt) {
        await updateOffline('debts', editDebt._id || editDebt.id, { ...form, amount: Number(form.amount) });
        showToast(t('debts.confirmed_updated'), 'success');
      } else {
        await createOffline('debts', { ...form, amount: Number(form.amount) });
        showToast(t('debts.confirmed_recorded'), 'success');
      }
      setShowForm(false); setEditDebt(null);
      setForm({ customerName: '', customerPhone: '', amount: '', description: '', dueDate: '', notes: '' });
      fetchDebts(true);
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const handlePay = async (e) => {
    e.preventDefault();
    if (!showPay || !payAmount) return;
    try {
      await apiAction(`/debts/${showPay._id || showPay.id}/pay`, 'POST', { paymentAmount: Number(payAmount) });
      showToast(t('debts.confirmed_payment'), 'success');
      setShowPay(null); setPayAmount('');
      fetchDebts(true);
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const handleReminder = async (id) => {
    try { await apiAction(`/debts/${id}/reminder`, 'POST'); showToast(t('debts.confirmed_reminder'), 'success'); } catch (err) { showToast(err.error || t('debts.failed_reminder'), 'error'); }
  };

  const handleReminderAll = async () => {
    if (!confirm(t('debt.remind_all_confirm'))) return;
    try { const res = await apiAction('/debts/reminder-all', 'POST'); showToast(res.message || t('debts.confirmed_reminders_sent'), 'success'); } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('debt.delete_confirm'))) return;
    try { await deleteOffline('debts', id); showToast(t('debts.confirmed_deleted'), 'success'); fetchDebts(true); } catch { showToast(t('common.failed'), 'error'); }
  };

  const openEdit = (d) => {
    setEditDebt(d);
    setForm({ customerName: d.customerName, customerPhone: d.customerPhone || '', amount: d.amount, description: d.description || '', dueDate: d.dueDate ? new Date(d.dueDate).toISOString().split('T')[0] : '', notes: d.notes || '' });
    setShowForm(true);
  };

  const filtered = debts.filter((d) => {
    if (filter !== 'all' && d.status?.toLowerCase() !== filter) return false;
    if (search && !(d.customerName || '').toLowerCase().includes(search.toLowerCase()) && !(d.customerPhone || '').includes(search)) return false;
    return true;
  });

  const totalUnpaid = debts.filter((d) => d.status !== 'paid').reduce((s, d) => s + ((d.amount || 0) - (d.paidAmount || 0)), 0);
  const totalDebt = debts.reduce((s, d) => s + (d.amount || 0), 0);
  const totalPaid = debts.reduce((s, d) => s + (d.paidAmount || 0), 0);
  const overdue = debts.filter(d => d.dueDate && new Date(d.dueDate) < new Date() && d.status !== 'paid').length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-hand-holding-usd mr-2 text-primary-600"></i>
            {t('debt.title')}
          </h1>
          {!isOnline && (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200"><i className="fas fa-wifi-slash"></i> Offline</span>)}
          <p className="text-sm text-gray-500 mt-1">{debts.length} {t('debts.title')} — {t('debts.unpaid_total')}: {totalUnpaid.toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => setShowReportModal(true)}>
            <i className="fas fa-file-pdf mr-1.5"></i> {t('debts.report')}
          </button>
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={handleReminderAll}>
            <i className="fab fa-whatsapp mr-1.5"></i> {t('debt.remind_all')}
          </button>
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { setEditDebt(null); setForm({ customerName: '', customerPhone: '', amount: '', description: '', dueDate: '', notes: '' }); setShowForm(true); }}>
            <i className="fas fa-plus mr-1.5"></i> {t('debt.add')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="fa-hand-holding-usd" color="blue" value={totalDebt.toLocaleString()} label={t('debts.stat_total_debt')} />
        <StatCard icon="fa-check-circle" color="green" value={totalPaid.toLocaleString()} label={t('debts.stat_paid')} />
        <StatCard icon="fa-exclamation-circle" color="red" value={totalUnpaid.toLocaleString()} label={t('debts.stat_remaining')} />
        <StatCard icon="fa-clock" color={overdue > 0 ? 'yellow' : 'green'} value={overdue} label={t('debts.stat_overdue')} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder={t('debt.search_placeholder')} className="flex-1 min-w-[200px] max-w-[300px]" />
        {['all', 'unpaid', 'partial', 'paid'].map((f) => (
          <button key={f} className={`text-xs px-2.5 py-1.5 rounded-lg font-medium ${filter === f ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors'}`} onClick={() => setFilter(f)}>
            {t(`debts.filter_${f}`)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6 border-l-4 border-l-primary-500">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editDebt ? t('debts.edit_title') : t('debt.add')}</h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.customer_name')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.phone')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="255..." />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.amount')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.due_date')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.description')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debt.notes')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { setShowForm(false); setEditDebt(null); }}>{t('common.cancel')}</button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">{editDebt ? t('common.save') : t('debt.add')}</button>
            </div>
          </form>
        </div>
      )}

      {showPay && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6 border-l-4 border-l-success-600">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              <i className="fas fa-money-bill mr-2 text-success-600"></i>
              {t('debts.record_payment_title')} — {showPay.customerName}
            </h3>
          </div>
          <form onSubmit={handlePay}>
            <div className="text-sm text-gray-500 mb-4">
              {t('debts.total_label')}: {(showPay.amount || 0).toLocaleString()} | {t('debts.paid_label')}: {(showPay.paidAmount || 0).toLocaleString()} | {t('debts.remaining_label')}: {((showPay.amount || 0) - (showPay.paidAmount || 0)).toLocaleString()}
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('debts.payment_amount')} *</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="number" step="0.01" min="1" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} required max={(showPay.amount || 0) - (showPay.paidAmount || 0)} />
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { setShowPay(null); setPayAmount(''); }}>{t('common.cancel')}</button>
              <button type="submit" className="bg-success-600 text-white hover:bg-success-700 px-4 py-2 rounded-xl text-sm font-semibold">{t('debts.record_payment_btn')}</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <i className="fas fa-hand-holding-usd text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-medium text-gray-900">{t('debt.no_debts')}</h3>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_customer')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_phone')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_amount')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_paid')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_remaining')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_status')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_recorded_by')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('debts.col_due')}</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const remaining = (d.amount || 0) - (d.paidAmount || 0);
                  return (
                    <tr key={d._id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer" onClick={() => openDetail(d)}>
                      <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{d.customerName}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-500">{d.customerPhone || 'N/A'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{(d.amount || 0).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{(d.paidAmount || 0).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{remaining.toLocaleString()}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{d.recordedBy || 'Owner'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-500">{d.dueDate ? new Date(d.dueDate).toLocaleDateString() : '—'}</td>
                      <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <DebtActionsMenu
                          debt={d}
                          remaining={remaining}
                          t={t}
                          onPay={() => { setShowPay(d); setPayAmount(''); }}
                          onRemind={() => handleReminder(d._id)}
                          onView={() => openDetail(d)}
                          onEdit={() => openEdit(d)}
                          onDelete={() => handleDelete(d._id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {/* Mobile Cards */}
        <div className="md:hidden space-y-3">
          {filtered.map((d) => {
            const remaining = (d.amount || 0) - (d.paidAmount || 0);
            return (
              <div key={d._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 cursor-pointer" {...rowActivate(() => openDetail(d))}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-gray-900">{d.customerName}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="text-xs text-gray-400 mb-2">{d.customerPhone || 'N/A'} {d.dueDate ? `· ${t('debts.col_due')} ${new Date(d.dueDate).toLocaleDateString()}` : ''} · {t('debts.col_recorded_by')}: {d.recordedBy || 'Owner'}</div>
                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div><span className="text-gray-400">{t('debts.mobile_amount')}</span><div className="font-semibold text-gray-900">{(d.amount || 0).toLocaleString()}</div></div>
                  <div><span className="text-gray-400">{t('debts.mobile_paid')}</span><div className="font-semibold text-gray-900">{(d.paidAmount || 0).toLocaleString()}</div></div>
                  <div><span className="text-gray-400">{t('debts.mobile_remaining')}</span><div className="font-semibold text-danger-600">{remaining.toLocaleString()}</div></div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100" role="presentation" onClick={(e) => e.stopPropagation()}>
                  <DebtActionsMenu
                    debt={d}
                    remaining={remaining}
                    t={t}
                    onPay={() => { setShowPay(d); setPayAmount(''); }}
                    onRemind={() => handleReminder(d._id)}
                    onView={() => openDetail(d)}
                    onEdit={() => openEdit(d)}
                    onDelete={() => handleDelete(d._id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('debts', 'debts-report.pdf', p)} lang={lang} />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.customerName || t('debts.title')}
        fields={detail ? debtFields(detail) : []}
        footer={detail && (
          <>
            {(() => {
              const rem = (detail.amount || 0) - (detail.paidAmount || 0);
              return (
                <>
                  {rem > 0 && (
                    <button className="bg-success-600 text-white hover:bg-success-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { const d = detail; setDetail(null); setShowPay(d); setPayAmount(''); }}>
                      <i className="fas fa-money-bill mr-1.5"></i> {t('debts.pay_btn')}
                    </button>
                  )}
                  {rem > 0 && detail.customerPhone && (
                    <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { const id = detail._id; setDetail(null); handleReminder(id); }}>
                      <i className="fab fa-whatsapp mr-1.5"></i> {t('debts.reminder_btn')}
                    </button>
                  )}
                  <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { const d = detail; setDetail(null); openEdit(d); }}>
                    <i className="fas fa-pen mr-1.5"></i> {t('common.edit')}
                  </button>
                </>
              );
            })()}
          </>
        )}
      />
    </div>
  );
}

function DebtActionsMenu({ debt, remaining, t, onView, onPay, onRemind, onEdit, onDelete }) {
  const [open, setOpen] = useState(null);
  const items = [
    {
      label: t('common.view'),
      icon: 'fa-eye',
      cls: 'text-gray-700 hover:bg-gray-50',
      run: onView,
    },
    ...(remaining > 0
      ? [{
          label: t('debts.pay_btn'),
          icon: 'fa-money-bill',
          cls: 'text-success-700 hover:bg-success-50',
          run: onPay,
        }]
      : []),
    ...(remaining > 0 && debt.customerPhone
      ? [{
          label: t('debts.reminder_btn'),
          icon: 'fab fa-whatsapp',
          cls: 'text-gray-700 hover:bg-gray-50',
          run: onRemind,
        }]
      : []),
    {
      label: t('common.edit'),
      icon: 'fa-pen',
      cls: 'text-gray-700 hover:bg-gray-50',
      run: onEdit,
    },
    {
      label: t('common.delete'),
      icon: 'fa-trash',
      cls: 'text-danger-700 hover:bg-danger-50',
      run: onDelete,
    },
  ];
  return (
    <div className="relative inline-block text-left">
      <button
        className="text-gray-400 hover:text-gray-700 p-2 rounded-lg hover:bg-gray-100"
        onClick={(e) => { e.stopPropagation(); setOpen(open ? null : debt._id); }}
        title={t('common.actions')}
      >
        <i className="fas fa-ellipsis-v"></i>
      </button>
      {open && (
        <>
          <button type="button" aria-label="Dismiss" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(null)} />
          <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-100 z-20 py-1">
            {items.map((it) => (
              <button
                key={it.label}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 ${it.cls}`}
                onClick={(e) => { e.stopPropagation(); setOpen(null); it.run(); }}
              >
                <i className={`fas ${it.icon}`}></i> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
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
