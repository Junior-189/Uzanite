import { confirmDialog, promptDialog } from '../utils/dialog';
import { useState, useEffect, useRef } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import { isRoutedToPlatform } from '../utils/apiRouting';
import { uploadFile } from '../utils/files';
import { useLoadMore } from '../hooks/useLoadMore';
import { fetchFromCacheOrApi, createOffline, updateOffline, deleteOffline } from '../db/helpers';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { imgUrl } from '../utils/imgUrl';
import StatCard from '../components/StatCard';
import PeriodFilter from '../components/PeriodFilter';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import { KebabMenu, DetailModal } from '../components/TableDetail';
import { getAccessToken } from '../utils/tokenStore';
import { rowActivate } from '../utils/rowActivate';

export default function Purchases() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const API_URL = import.meta.env.VITE_API_URL || '/api';
  const [purchases, setPurchases] = useState([]);
  const { nextCursor, setNextCursor, loadMore, loadingMore } = useLoadMore('purchases', (items) =>
    setPurchases((prev) => [...prev, ...items])
  );
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editPurchase, setEditPurchase] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const receiptInputRef = useRef(null);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [form, setForm] = useState({ productName: '', quantity: '', costPerUnit: '', supplier: '', notes: '', date: new Date().toISOString().split('T')[0], expiryDate: '', receiptPath: '' });
  const [period, setPeriod] = useState('alltime');
  const [showReportModal, setShowReportModal] = useState(false);
  const [detail, setDetail] = useState(null);

  const openDetail = (p) => setDetail(p);
  const purchaseFields = (p) => ([
    { label: t('purchase.product'), value: p.productName },
    { label: t('common.quantity'), value: p.quantity },
    { label: t('purchase.cost_per_unit'), value: `${(p.costPerUnit || 0).toLocaleString()} TZS` },
    { label: t('common.total'), value: `${(p.totalCost || 0).toLocaleString()} TZS` },
    { label: t('purchase.supplier'), value: p.supplier || t('common.none') },
    { label: t('purchase.date'), value: p.date ? new Date(p.date).toLocaleDateString() : '—' },
    { label: t('purchases.col_recorded_by'), value: p.recordedBy || 'Owner' },
    ...(p.expiryDate ? [{ label: t('purchase.expiry_date'), value: new Date(p.expiryDate).toLocaleDateString() }] : []),
    ...(p.notes ? [{ label: t('purchase.notes'), value: p.notes }] : []),
    ...(p.receiptPath ? [{ label: t('purchase.receipt'), value: 'receipt', receiptUrl: imgUrl(p.receiptPath) }] : []),
  ]);

  useEffect(() => { Promise.all([fetchPurchases(), fetchProducts()]).then(() => setLoading(false)); }, []);

  const fetchPurchases = async (forceRefresh = false) => {
    try {
      const items = await fetchFromCacheOrApi('purchases', { forceRefresh });
      setPurchases(items);
      if (isOnline) {
        try {
          const res = await api.get('/purchases', { params: { limit: 50 } });
          if (res.success && Array.isArray(res.purchases)) { setPurchases(res.purchases); setNextCursor(res.nextCursor || null); }
        } catch { /* keep cached */ }
      }
    } catch {}
  };
  const fetchProducts = async () => { try { const res = await api.get('/products'); if (res.success) setProducts(res.products || []); } catch {} };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editPurchase) { await deleteOffline('purchases', editPurchase._id || editPurchase.id); }

      const payload = {
        ...form,
        quantity: Number(form.quantity),
        costPerUnit: Number(form.costPerUnit),
        expiryDate: form.expiryDate || null,
      };

      if (navigator.onLine && isRoutedToPlatform('/purchases')) {
        const body = { ...payload, clientRef: crypto.randomUUID() };
        if (receiptFile) body.receiptKey = (await uploadFile(receiptFile, 'other')).key;
        const json = await api.post('/purchases', body);
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(editPurchase ? t('purchases.confirmed_updated') : t('purchases.confirmed_recorded'), 'success');
      } else if (navigator.onLine) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(payload)) {
          if (v !== undefined && v !== null) fd.append(k, String(v));
        }
        if (receiptFile) fd.append('receipt', receiptFile);
        fd.append('clientRef', crypto.randomUUID());

        const token = getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_URL}/purchases`, { method: 'POST', headers, body: fd });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(editPurchase ? t('purchases.confirmed_updated') : t('purchases.confirmed_recorded'), 'success');
      } else {
        await createOffline('purchases', { ...payload, receiptBlob: receiptFile || null });
        showToast(editPurchase ? t('purchases.confirmed_updated') : t('purchases.confirmed_recorded'), 'success');
      }

      setShowForm(false); setEditPurchase(null); setReceiptFile(null);
      setForm({ productName: '', quantity: '', costPerUnit: '', supplier: '', notes: '', date: new Date().toISOString().split('T')[0], expiryDate: '', receiptPath: '' });
      fetchPurchases(true);
    } catch (err) { showToast(err.error || err.message || t('common.failed'), 'error'); }
  };

  const handleDelete = async (id) => {
    if (!(await confirmDialog(t('purchase.delete_confirm')))) return;
    try { await deleteOffline('purchases', id); showToast(t('purchases.confirmed_deleted'), 'success'); fetchPurchases(true); } catch { showToast(t('common.failed'), 'error'); }
  };

  const openReceiptUpload = (p) => {
    setReceiptTarget(p);
    if (receiptInputRef.current) receiptInputRef.current.value = '';
    receiptInputRef.current?.click();
  };

  const handleReceiptPick = async (e) => {
    const file = e.target.files && e.target.files[0];
    const p = receiptTarget;
    setReceiptTarget(null);
    if (!file || !p) return;
    const id = p._id || p.id;
    try {
      if (navigator.onLine && isRoutedToPlatform('/purchases')) {
        const receiptKey = (await uploadFile(file, 'other')).key;
        const json = await api.patch(`/purchases/${id}`, { receiptKey });
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(t('purchase.receipt_uploaded'), 'success');
      } else if (navigator.onLine) {
        const fd = new FormData();
        fd.append('receipt', file);
        const token = getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_URL}/purchases/${id}`, { method: 'PATCH', headers, body: fd });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(t('purchase.receipt_uploaded'), 'success');
      } else {
        await updateOffline('purchases', id, { receiptBlob: file });
        showToast(t('purchase.receipt_uploaded'), 'success');
      }
      fetchPurchases(true);
    } catch (err) { showToast(err.error || err.message || t('common.failed'), 'error'); }
  };

  const handleDeleteReceipt = async (p) => {
    if (!(await confirmDialog(t('purchase.delete_receipt_confirm')))) return;
    const id = p._id || p.id;
    try {
      if (navigator.onLine && isRoutedToPlatform('/purchases')) {
        const json = await api.patch(`/purchases/${id}`, { receiptKey: '' });
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(t('purchase.receipt_deleted'), 'success');
      } else if (navigator.onLine) {
        const token = getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
        const res = await fetch(`${API_URL}/purchases/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ receiptPath: '' }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || t('common.failed'));
        showToast(t('purchase.receipt_deleted'), 'success');
      } else {
        await updateOffline('purchases', id, { receiptPath: '' });
        showToast(t('purchase.receipt_deleted'), 'success');
      }
      fetchPurchases(true);
    } catch (err) { showToast(err.error || err.message || t('common.failed'), 'error'); }
  };

  const openEdit = (p) => {
    setEditPurchase(p);
    setReceiptFile(null);
    setForm({ productName: p.productName, quantity: p.quantity, costPerUnit: p.costPerUnit, supplier: p.supplier || '', notes: p.notes || '', date: p.date ? new Date(p.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0], expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString().split('T')[0] : '', receiptPath: p.receiptPath || '' });
    setShowForm(true);
  };

  const filtered = purchases.filter((p) => {
    if (period !== 'alltime' && p.date) {
      const d = new Date(p.date);
      const now = new Date();
      if (period === 'daily' && d < new Date(now - 86400000)) return false;
      if (period === 'weekly' && d < new Date(now - 7 * 86400000)) return false;
      if (period === 'monthly' && d < new Date(now.getFullYear(), now.getMonth(), 1)) return false;
      if (period === 'annually' && d < new Date(now.getFullYear(), 0, 1)) return false;
    }
    return true;
  });

  const totalSpent = filtered.reduce((s, p) => s + (p.totalCost || 0), 0);
  const avgPurchase = filtered.length > 0 ? Math.round(totalSpent / filtered.length) : 0;
  const totalItems = filtered.reduce((s, p) => s + (p.quantity || 0), 0);
  const suppliers = [...new Set(filtered.map(p => p.supplier).filter(Boolean))];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            <i className="fas fa-shopping-cart mr-2 text-primary-600"></i>
            {t('purchase.title')}
          </h1>
          {!isOnline && (<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200"><i className="fas fa-wifi-slash"></i> Offline</span>)}
          <p className="text-sm text-gray-500 mt-1">{purchases.length} {t('purchases.purchases_total')} — {t('common.total')}: {totalSpent.toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => setShowReportModal(true)}>
            <i className="fas fa-file-pdf mr-1.5"></i> {t('purchases.report')}
          </button>
          <button className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold" onClick={() => { setEditPurchase(null); setReceiptFile(null); setForm({ productName: '', quantity: '', costPerUnit: '', supplier: '', notes: '', date: new Date().toISOString().split('T')[0], expiryDate: '', receiptPath: '' }); setShowForm(true); }}>
            <i className="fas fa-plus mr-1.5"></i> {t('purchase.add')}
          </button>
        </div>
      </div>

      <PeriodFilter value={period} onChange={setPeriod} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="fa-money-bill-wave" color="pink" value={totalSpent.toLocaleString()} label={t('purchases.stat_total_spent')} />
        <StatCard icon="fa-calculator" color="orange" value={avgPurchase.toLocaleString()} label={t('purchases.stat_avg_purchase')} />
        <StatCard icon="fa-boxes" color="blue" value={totalItems} label={t('purchases.stat_items_bought')} />
        <StatCard icon="fa-truck" color="green" value={suppliers.length} label={t('purchases.stat_suppliers')} />
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6 border-l-4 border-l-primary-500">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">{editPurchase ? t('purchases.edit_title') : t('purchase.new')}</h3>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.product_name')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.quantity')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.cost_per_unit')} *</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="number" step="0.01" min="0" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.supplier')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.date')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.expiry_date')}</label>
                <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.notes')}</label>
              <input className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('purchase.receipt')}</label>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 file:cursor-pointer" onChange={(e) => setReceiptFile(e.target.files[0] || null)} />
              {form.receiptPath && !receiptFile && (
                <a href={imgUrl(form.receiptPath)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mt-2 text-sm text-primary-600 hover:underline">
                  <i className="fas fa-receipt"></i> {t('purchase.view_receipt')}
                </a>
              )}
              {receiptFile && (
                <span className="inline-block mt-2 text-sm text-gray-500"><i className="fas fa-check mr-1 text-success-600"></i> {receiptFile.name}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium" onClick={() => { setShowForm(false); setEditPurchase(null); }}>{t('common.cancel')}</button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">{editPurchase ? t('common.save') : t('purchase.add')}</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : purchases.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <i className="fas fa-shopping-cart text-2xl text-gray-400"></i>
          </div>
          <h3 className="text-lg font-medium text-gray-900">{t('purchase.no_purchases')}</h3>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/50">
                   <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.product')}</th>
                   <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.quantity')}</th>
                   <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.receipt')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchases.col_cost_unit')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('common.total')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.supplier')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchases.col_recorded_by')}</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.expiry_date')}</th>
                   <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">{t('purchase.date')}</th>
                   <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p._id}
                    onClick={() => openDetail(p)}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{p.productName}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-700">{p.quantity}</td>
                    <td className="px-5 py-3.5">
                      {p.receiptPath ? (
                        <a href={imgUrl(p.receiptPath)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={t('purchase.view_receipt')}>
                          <img src={imgUrl(p.receiptPath)} alt="receipt" className="h-10 w-10 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                        </a>
                      ) : <span className="text-sm text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-700">{(p.costPerUnit || 0).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-700">{(p.totalCost || 0).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{p.supplier || t('common.none')}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{p.recordedBy || 'Owner'}</td>
                    <PurchaseExpiryCell purchase={p} t={t} />
                    <td className="px-5 py-3.5 text-sm text-gray-500">{new Date(p.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <KebabMenu
                          t={t}
                          items={[
                            { label: t('common.view'), icon: 'fa-eye', cls: 'text-gray-700 hover:bg-gray-50', run: () => openDetail(p) },
                            { label: t('common.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(p) },
                            { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(p._id) },
                            { label: t('purchase.upload_receipt'), icon: 'fa-receipt', cls: 'text-gray-700 hover:bg-gray-50', run: () => openReceiptUpload(p) },
                            ...(p.receiptPath ? [{ label: t('purchase.delete_receipt'), icon: 'fa-times-circle', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDeleteReceipt(p) }] : []),
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
          {filtered.map((p) => (
            <div key={p._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 cursor-pointer" {...rowActivate(() => openDetail(p))}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-gray-900">{p.productName}</span>
                <span className="text-sm font-bold text-gray-900">{(p.totalCost || 0).toLocaleString()}</span>
              </div>
              <div className="text-xs text-gray-400 mb-2">{p.supplier || t('purchases.no_supplier')} · {new Date(p.date).toLocaleDateString()}</div>
              <div className="text-xs text-gray-500 mb-2"><i className="fas fa-user mr-1 text-gray-400"></i>{t('purchases.col_recorded_by')}: <strong className="text-gray-700">{p.recordedBy || 'Owner'}</strong></div>
              {p.receiptPath && (
                <a href={imgUrl(p.receiptPath)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 mb-2 text-xs text-primary-600 hover:underline">
                  <img src={imgUrl(p.receiptPath)} alt="receipt" className="h-12 w-12 object-cover rounded-lg border border-gray-200" /> {t('purchase.view_receipt')}
                </a>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div><span className="text-gray-400">{t('common.quantity')}</span><div className="font-semibold text-gray-900">{p.quantity}</div></div>
                <div><span className="text-gray-400">{t('purchases.col_cost_unit')}</span><div className="font-semibold text-gray-900">{(p.costPerUnit || 0).toLocaleString()}</div></div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100" role="presentation" onClick={(e) => e.stopPropagation()}>
                 <KebabMenu
                   t={t}
                   items={[
                     { label: t('common.edit'), icon: 'fa-pen', cls: 'text-gray-700 hover:bg-gray-50', run: () => openEdit(p) },
                     { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDelete(p._id) },
                     { label: t('purchase.upload_receipt'), icon: 'fa-receipt', cls: 'text-gray-700 hover:bg-gray-50', run: () => openReceiptUpload(p) },
                     ...(p.receiptPath ? [{ label: t('purchase.delete_receipt'), icon: 'fa-times-circle', cls: 'text-danger-700 hover:bg-danger-50', run: () => handleDeleteReceipt(p) }] : []),
                   ]}
                 />
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('purchases', 'purchases-report.pdf', p)} lang={lang} />

      <input ref={receiptInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleReceiptPick} />

      <DetailModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.productName || t('purchase.title')}
        fields={detail ? purchaseFields(detail) : []}
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

function expiryState(date, warnDays = 7, now = new Date()) {
  if (!date) return null;
  const d = new Date(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= warnDays) return 'near';
  return null;
}

function PurchaseExpiryCell({ purchase, t }) {
  const date = purchase.expiryDate;
  if (!date) return <td className="px-5 py-3.5 text-sm text-gray-300">—</td>;
  const state = expiryState(date, 7);
  const cls = state === 'expired'
    ? 'text-danger-600 font-semibold'
    : state === 'near'
      ? 'text-warning-600 font-semibold'
      : 'text-gray-500';
  return (
    <td className={`px-5 py-3.5 text-sm ${cls}`}>
      {new Date(date).toLocaleDateString()}
      {state === 'expired' && <div className="text-[10px]">{t('products.expired')}</div>}
      {state === 'near' && <div className="text-[10px]">{t('products.expiring_soon')}</div>}
    </td>
  );
}
