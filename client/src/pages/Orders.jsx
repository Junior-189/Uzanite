import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { resumeAudio } from '../utils/beep';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import { isRoutedToPlatform } from '../utils/apiRouting';
import { uploadFile } from '../utils/files';
import StatusBadge from '../components/StatusBadge';
import StatCard from '../components/StatCard';
import PeriodFilter from '../components/PeriodFilter';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import PosScanner from '../components/PosScanner';
import LoadMore from '../components/LoadMore';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import { fetchFromCacheOrApi, createOffline, deleteOffline, apiAction } from '../db/helpers';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { rowActivate } from '../utils/rowActivate';

export default function Orders() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const [products, setProducts] = useState([]);
  const [showPos, setShowPos] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [payTarget, setPayTarget] = useState(null);
  const [payForm, setPayForm] = useState({ provider: 'manual', method: 'mpesa', phone: '', reference: '', proof: null });
  const [payLoading, setPayLoading] = useState(false);

  const openPos = () => {
    // Resume the AudioContext inside the click gesture so the beep is allowed to play.
    resumeAudio();
    setShowPos(true);
  };

  useEffect(() => { fetchOrders(); }, [period]);
  useEffect(() => { api.get('/products').then(r => { if (r.success) setProducts(r.products || []); }).catch(() => {}); }, []);

  const fetchOrders = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const params = {};
      if (period !== 'all' && period !== 'alltime') params.period = period;
      const items = await fetchFromCacheOrApi('orders', { params, forceRefresh });
      setOrders(items);
      // When online, fetch the first page with a cursor for incremental loading.
      if (isOnline) {
        try {
          const res = await api.get('/orders', { params: { ...params, limit: 20 } });
          if (res.success && Array.isArray(res.orders)) {
            setOrders(res.orders);
            setNextCursor(res.nextCursor || null);
          }
        } catch { /* keep cached list */ }
      } else {
        setNextCursor(null);
      }
    } catch { showToast(t('orders.failed_to_load'), 'error'); }
    finally { setLoading(false); }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = {};
      if (period !== 'all' && period !== 'alltime') params.period = period;
      const res = await api.get('/orders', { params: { ...params, limit: 20, cursor: nextCursor } });
      if (res.success) {
        setOrders((prev) => [...prev, ...(res.orders || [])]);
        setNextCursor(res.nextCursor || null);
      }
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const loadDetail = async (id) => {
    try { const res = await api.get(`/orders/${id}`); if (res.success) setDetail(res.order); } catch { showToast(t('common.failed'), 'error'); }
  };

  const doAction = async (id, action, body) => {
    // State changes require the server; acting offline would silently diverge
    // from money/stock. Refuse instead of reporting a false success.
    if (!isOnline) {
      showToast(t('common.requires_connection') || 'You are offline — reconnect to make changes', 'error');
      return;
    }
    setActionLoading(action + id);
    try {
      await apiAction(`/orders/${id}/${action}`, 'POST', body || {});
      showToast(`${action.replace('-', ' ')} success`, 'success');
      fetchOrders(true);
      api.get('/products').then(r => { if (r.success) setProducts(r.products || []); }).catch(() => {});
      if (detail?._id === id) loadDetail(id);
    } catch (err) { showToast(err.error || t('common.failed'), 'error'); }
    finally { setActionLoading(''); }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('orders.confirm_delete'))) return;
    try {
      await deleteOffline('orders', id);
      showToast(t('orders.confirmed_deleted'), 'success');
      fetchOrders(true);
      api.get('/products').then(r => { if (r.success) setProducts(r.products || []); }).catch(() => {});
      setDetail(null);
    } catch { showToast(t('common.failed'), 'error'); }
  };

  const downloadReceipt = async (id) => {
    try {
      const blob = await api.get(`/orders/${id}/receipt`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `receipt-${id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast(t('common.failed'), 'error');
    }
  };

  const filtered = orders.filter((o) => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (o.orderNumber || '').toLowerCase().includes(s) || (o.customerName || o.customer || '').toLowerCase().includes(s) || (o.customerPhone || o.phone || '').includes(s);
  });

  const statusKey = (s) => ({ PENDING: 'pending', APPROVED: 'approved', PENDING_PAYMENT: 'pending_payment', PAID: 'paid', DELIVERED: 'delivered', REJECTED: 'rejected' }[s] || 'pending');

  const savePosOrder = async (order) => {
    for (const item of order.items) {
      const p = products.find((x) => x._id === item.productId);
      if (p && item.quantity > (p.stock || 0)) {
        showToast(`${item.productName}: ${t('orders.insufficient_stock')} (${p.stock})`, 'error');
        return false;
      }
    }
    try {
      await createOffline('orders', {
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        items: order.items.map((i) => ({ productId: i.productId, productName: i.productName, price: i.price, quantity: i.quantity, subtotal: i.price * i.quantity })),
        total: order.total,
        paymentMethod: order.paymentMethod,
        source: 'cash',
        status: 'PAID',
        recordedBy: user?.name || 'Owner',
      });
      showToast(isOnline ? t('orders.confirmed_created') : t('orders.confirmed_offline'), 'success');
      fetchOrders(true);
      api.get('/products').then((r) => { if (r.success) setProducts(r.products || []); }).catch(() => {});
      return true;
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
      return false;
    }
  };

  const orderStats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'PENDING').length,
    approved: orders.filter(o => o.status === 'APPROVED').length,
    pendingPayment: orders.filter(o => o.status === 'PENDING_PAYMENT').length,
    paid: orders.filter(o => o.status === 'PAID').length,
    delivered: orders.filter(o => o.status === 'DELIVERED').length,
    rejected: orders.filter(o => o.status === 'REJECTED').length,
    revenue: orders.filter(o => o.status === 'PAID' || o.status === 'DELIVERED').reduce((s, o) => s + (o.total || 0), 0),
  };

  const sourceBadge = (source) => (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${source === 'cash' ? 'bg-success-50 text-success-700 border border-success-200' : 'bg-primary-50 text-primary-700 border border-primary-200'}`}>
      {source === 'cash' ? t('orders.cash') : t('orders.whatsapp')}
    </span>
  );

  const recordedByBadge = (order) => (
    order.source === 'whatsapp' ? (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-700 border border-primary-200">
        <i className="fab fa-whatsapp"></i> {t('orders.whatsapp')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success-50 text-success-700 border border-success-200">
        <i className="fas fa-user"></i> {order.recordedBy || t('orders.owner')}
      </span>
    )
  );

  const sendReceipt = async (id) => {
    setActionLoading('send-receipt' + id);
    try { await api.post(`/orders/${id}/send-receipt`); showToast(t('orders.confirmed_receipt_sent'), 'success'); setReceiptTarget(null); }
    catch (err) { showToast(err.error || t('orders.failed_receipt_send'), 'error'); }
    finally { setActionLoading(''); }
  };

  const openPay = (order) => {
    setPayTarget(order);
    setPayForm({ provider: 'manual', method: 'mpesa', phone: order.customerPhone || '', reference: '', proof: null });
  };

  const submitPay = async () => {
    if (!payTarget) return;
    setPayLoading(true);
    try {
      if (payForm.provider === 'manual') {
        const manualPath = `/payments/orders/${payTarget._id}/manual`;
        if (isRoutedToPlatform(manualPath)) {
          // Platform: upload the proof first, then confirm by key (JSON).
          let proofPath = null;
          if (payForm.proof) proofPath = (await uploadFile(payForm.proof, 'payment_proof')).key;
          await api.post(manualPath, {
            method: payForm.method,
            reference: payForm.reference || 'N/A',
            proofPath,
          });
        } else {
          const fd = new FormData();
          fd.append('method', payForm.method);
          fd.append('reference', payForm.reference || '');
          if (payForm.proof) fd.append('proof', payForm.proof);
          await api.post(manualPath, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        }
        showToast(t('orders.payment_confirmed'), 'success');
      } else {
        const res = await api.post(`/payments/orders/${payTarget._id}/initiate`, {
          provider: payForm.provider,
          method: payForm.method,
          phone: payForm.phone,
        });
        showToast(res.payment?.status === 'succeeded' ? t('orders.payment_confirmed') : t('orders.payment_initiated'), 'success');
      }
      const targetId = payTarget._id;
      setPayTarget(null);
      fetchOrders(true);
      if (detail && detail._id === targetId) loadDetail(targetId);
    } catch (err) {
      showToast(err.error || t('orders.payment_failed'), 'error');
    } finally {
      setPayLoading(false);
    }
  };

  const statCards = [
    { key: 'all', icon: 'fa-shopping-bag', color: 'blue', value: orderStats.total, label: t('orders.stat_all') },
    { key: 'PENDING', icon: 'fa-clock', color: 'yellow', value: orderStats.pending, label: t('orders.stat_pending') },
    { key: 'PAID', icon: 'fa-check-double', color: 'green', value: orderStats.paid, label: t('orders.stat_paid') },
    { key: 'DELIVERED', icon: 'fa-truck', color: 'cyan', value: orderStats.delivered, label: t('orders.stat_delivered') },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i className="fas fa-clipboard-list text-primary-600"></i> {t('orders.title')}
          </h1>
          {!isOnline && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200">
              <i className="fas fa-wifi-slash"></i> {t('orders.offline_mode')}
            </span>
          )}
          <p className="text-sm text-gray-500 mt-1">{filtered.length} {t('orders.orders_count')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => setShowReportModal(true)}>
            <i className="fas fa-file-pdf mr-1"></i> {t('orders.report')}
          </button>
          <button className="bg-success-600 text-white hover:bg-success-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" onClick={openPos}>
            <i className="fas fa-money-bill mr-1"></i> {t('orders.cash_order')}
          </button>
          <button className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors" onClick={() => fetchOrders(true)}>
            <i className="fas fa-sync-alt mr-1"></i> {t('orders.refresh')}
          </button>
        </div>
      </div>

      <div className="mb-5">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-4 mb-5">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            icon={card.icon}
            color={card.color}
            value={card.value}
            label={card.label}
            onClick={() => setFilter(card.key)}
          />
        ))}
      </div>

      <div className="mb-5 max-w-sm">
        <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder') || 'Search orders...'} />
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        <div className="min-w-0 w-full">
          {loading ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="inline-block w-8 h-8 border-3 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-3"></div>
              <p className="text-gray-500 text-sm">{t('orders.loading')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-clipboard-list text-2xl text-gray-400"></i>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('orders.no_orders')}</h3>
              <p className="text-sm text-gray-500">{t('orders.no_orders_hint')}</p>
            </div>
          ) : (
            <>
            {/* Desktop Table */}
            <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_order')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_customer')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_recorded_by')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_status')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_total')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_date')}</th>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('orders.col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((order) => (
                      <tr
                        key={order._id}
                        onClick={() => loadDetail(order._id)}
                        className={`cursor-pointer transition-colors hover:bg-gray-50/50 ${detail?._id === order._id ? 'bg-primary-50/50' : ''}`}
                      >
                        <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">{order.orderNumber}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-700">{order.customerName || order.customer || t('orders.walk_in')}</td>
                        <td className="px-5 py-3.5">{recordedByBadge(order)}</td>
                        <td className="px-5 py-3.5"><StatusBadge status={statusKey(order.status)} /></td>
                        <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{(order.total || 0).toLocaleString()} {order.currency || 'TZS'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                        <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <OrderActionsMenu
                            order={order}
                            actionLoading={actionLoading}
                            t={t}
                            onView={(id) => loadDetail(id)}
                            onAction={doAction}
                            onReceipt={downloadReceipt}
                            onSendReceipt={(id) => setReceiptTarget(id)}
                            onDelete={handleDelete}
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
              {filtered.map((order) => (
                <div key={order._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4" {...rowActivate(() => loadDetail(order._id))}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-gray-900">{order.orderNumber}</span>
                    <StatusBadge status={statusKey(order.status)} />
                  </div>
                  <div className="text-sm text-gray-600 mb-1">{order.customerName || order.customer || t('orders.walk_in')}</div>
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="font-semibold text-gray-900">{(order.total || 0).toLocaleString()} {order.currency || 'TZS'}</span>
                    <span className="text-gray-400 text-xs">{new Date(order.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center gap-2" role="presentation" onClick={(e) => e.stopPropagation()}>
                     <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors" onClick={(e) => { e.stopPropagation(); loadDetail(order._id); }}><i className="fas fa-eye mr-1"></i> {t('orders.view')}</button>
                     {recordedByBadge(order)}
                     {(order.status === 'PAID' || order.status === 'DELIVERED') && (
                       <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300" onClick={(e) => { e.stopPropagation(); downloadReceipt(order._id); }}><i className="fas fa-file-pdf mr-1"></i> {t('orders.receipt')}</button>
                     )}
                     <div className="flex-1"></div>
                     {order.status === 'PENDING' && (
                      <>
                        <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-success-600 text-white" disabled={!!actionLoading} onClick={() => doAction(order._id, 'approve')}>{t('orders.approve')}</button>
                        <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-danger-600 text-white" disabled={!!actionLoading} onClick={() => doAction(order._id, 'reject', { reason: 'Rejected' })}>{t('orders.reject')}</button>
                      </>
                    )}
                    {order.status === 'APPROVED' && (
                      <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-primary-600 text-white" disabled={!!actionLoading} onClick={() => doAction(order._id, 'request-payment')}>{t('orders.request_payment')}</button>
                    )}
                    {order.status === 'PENDING_PAYMENT' && (
                      <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-success-600 text-white" disabled={!!actionLoading} onClick={() => doAction(order._id, 'confirm-payment', { method: 'manual' })}>{t('orders.confirm_payment')}</button>
                    )}
                    {order.status === 'PAID' && (
                      <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-primary-600 text-white" disabled={!!actionLoading} onClick={() => doAction(order._id, 'deliver')}>{t('orders.deliver')}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>

        {detail && (
          <Modal open onClose={() => setDetail(null)} title={detail.orderNumber} maxWidth="max-w-lg">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <StatusBadge status={statusKey(detail.status)} />
                {sourceBadge(detail.source)}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 bg-gray-50 rounded-xl p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">{t('orders.customer_label')}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5 break-words">{detail.customerName || detail.customer || t('orders.walk_in')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">{t('orders.phone_label')}</p>
                  <p className="text-sm text-gray-700 mt-0.5 break-words">{detail.customerPhone || detail.phone || 'N/A'}</p>
                </div>
                {detail.recordedBy && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-400">{t('orders.recorded_by')}</p>
                    <p className="text-sm text-gray-700 mt-0.5 break-words">{detail.recordedBy}</p>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t('orders.items_label')}</h4>
                <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100">
                  {detail.items && detail.items.length > 0 ? detail.items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name || item.productName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t('orders.qty')}: {item.quantity}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">{(item.price * item.quantity || item.subtotal || 0).toLocaleString()} {detail.currency || 'TZS'}</span>
                    </div>
                  )) : (
                    <div className="px-4 py-3 text-sm text-gray-400">{t('orders.no_items')}</div>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">{t('orders.total')}</span>
                  <span className="text-lg font-bold text-gray-900">{(detail.total || 0).toLocaleString()} {detail.currency || 'TZS'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('orders.payment_label')}</span>
                  <span className="text-gray-700">{detail.paymentMethod || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('orders.date_label')}</span>
                  <span className="text-gray-700">{new Date(detail.createdAt).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                {detail.status === 'PENDING' && (
                  <>
                    <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-success-600 text-white hover:bg-success-700 transition-colors" disabled={!!actionLoading} onClick={() => doAction(detail._id, 'approve')}>
                      <i className="fas fa-check mr-1"></i> {t('orders.approve')}
                    </button>
                    <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors" disabled={!!actionLoading} onClick={() => doAction(detail._id, 'reject', { reason: 'Rejected by admin' })}>
                      <i className="fas fa-times mr-1"></i> {t('orders.reject')}
                    </button>
                  </>
                )}
                {detail.status === 'APPROVED' && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors" disabled={!!actionLoading} onClick={() => doAction(detail._id, 'request-payment')}>
                    <i className="fas fa-money-bill mr-1"></i> {t('orders.request_payment')}
                  </button>
                )}
                {detail.status === 'PENDING_PAYMENT' && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-success-600 text-white hover:bg-success-700 transition-colors" disabled={!!actionLoading} onClick={() => doAction(detail._id, 'confirm-payment', { method: 'manual' })}>
                    <i className="fas fa-check-double mr-1"></i> {t('orders.confirm_payment')}
                  </button>
                )}
                {detail.status === 'PAID' && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors" disabled={!!actionLoading} onClick={() => doAction(detail._id, 'deliver')}>
                    <i className="fas fa-truck mr-1"></i> {t('orders.mark_delivered')}
                  </button>
                )}
                {['PAID', 'DELIVERED'].includes(detail.status) && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors" onClick={() => downloadReceipt(detail._id)}>
                    <i className="fas fa-file-pdf mr-1"></i> {t('orders.receipt')}
                  </button>
                )}
                {['PAID', 'DELIVERED'].includes(detail.status) && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-success-600 text-white hover:bg-success-700 transition-colors" disabled={!!actionLoading} onClick={() => setReceiptTarget(detail._id)}>
                    <i className="fas fa-paper-plane mr-1"></i> {t('orders.send_receipt')}
                  </button>
                )}
                {['APPROVED', 'PENDING_PAYMENT', 'PENDING'].includes(detail.status) && (
                  <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-warning-500 text-white hover:bg-warning-600 transition-colors" onClick={() => openPay(detail)}>
                    <i className="fas fa-mobile-alt mr-1"></i> {t('orders.collect_payment')}
                  </button>
                )}
                <button className="text-xs px-3 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors" onClick={() => handleDelete(detail._id)}>
                  <i className="fas fa-trash mr-1"></i> {t('common.delete')}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>

      {showPos && (
          <PosScanner
            products={products}
            onClose={() => setShowPos(false)}
            onSave={savePosOrder}
          />
      )}

      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('orders', 'orders-report.pdf', p)} lang={lang} />

      <LoadMore onClick={loadMore} loading={loadingMore} hasMore={!!nextCursor} label={t('common.load_more') || 'Load more'} />

      {payTarget && (
        <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => setPayTarget(null)}
            className="absolute inset-0 w-full h-full cursor-default"
          />
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">{t('orders.collect_payment')}</h3>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={() => setPayTarget(null)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('orders.payment_provider')}</label>
                <select value={payForm.provider} onChange={(e) => setPayForm({ ...payForm, provider: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm">
                  <option value="manual">{t('orders.provider_manual')}</option>
                  <option value="clickpesa">ClickPesa</option>
                  <option value="azampay">AzamPay</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('orders.payment_method')}</label>
                <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm">
                  <option value="mpesa">M-Pesa</option>
                  <option value="tigo">Tigo / Mixx</option>
                  <option value="airtel">Airtel Money</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              {payForm.provider !== 'manual' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t('orders.payment_phone')}</label>
                  <input value={payForm.phone} onChange={(e) => setPayForm({ ...payForm, phone: e.target.value })} placeholder="2557XXXXXXXX" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
                </div>
              )}
              {payForm.provider === 'manual' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('orders.payment_reference')}</label>
                    <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="e.g. MP123456" className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('orders.payment_proof')}</label>
                    <input type="file" accept="image/*" onChange={(e) => setPayForm({ ...payForm, proof: (e.target.files && e.target.files[0]) || null })} className="w-full text-sm" />
                  </div>
                </>
              )}
              <button disabled={payLoading} onClick={submitPay} className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
                {payLoading ? t('common.saving') : (payForm.provider === 'manual' ? t('orders.confirm_payment') : t('orders.initiate_payment'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptTarget && (
        <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => setReceiptTarget(null)}
            className="absolute inset-0 w-full h-full cursor-default"
          />
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">{t('orders.send_receipt')}</h3>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={() => setReceiptTarget(null)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="p-4 space-y-2.5">
              <button
                disabled={!!actionLoading}
                onClick={() => sendReceipt(receiptTarget)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:bg-success-50 hover:border-success-200 transition-colors text-left disabled:opacity-50"
              >
                <span className="w-10 h-10 rounded-full bg-success-100 text-success-600 flex items-center justify-center shrink-0">
                  <i className="fab fa-whatsapp text-lg"></i>
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{t('orders.receipt_via_whatsapp')}</span>
                  <span className="block text-xs text-gray-500">{t('orders.receipt_whatsapp_hint')}</span>
                </span>
                {actionLoading === 'send-receipt' + receiptTarget ? <i className="fas fa-spinner fa-spin text-success-600"></i> : <i className="fas fa-chevron-right text-gray-300"></i>}
              </button>

              <div className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/60 text-left cursor-not-allowed">
                <span className="w-10 h-10 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center shrink-0">
                  <i className="fas fa-download text-base"></i>
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-400">{t('orders.receipt_offline')}</span>
                  <span className="block text-xs text-gray-400">{t('common.coming_soon')}</span>
                </span>
              </div>

              <div className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/60 text-left cursor-not-allowed">
                <span className="w-10 h-10 rounded-full bg-gray-200 text-gray-400 flex items-center justify-center shrink-0">
                  <i className="fas fa-envelope text-base"></i>
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-400">{t('orders.receipt_email')}</span>
                  <span className="block text-xs text-gray-400">{t('common.coming_soon')}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderActionsMenu({ order, actionLoading, t, onView, onAction, onReceipt, onSendReceipt, onDelete }) {
  const [open, setOpen] = useState(false);
  const items = [];
  items.push({ label: t('orders.view'), icon: 'fa-eye', cls: 'text-primary-700', run: () => onView(order._id) });
  if (order.status === 'PENDING') {
    items.push({ label: t('orders.approve'), icon: 'fa-check', cls: 'text-success-700', run: () => onAction(order._id, 'approve') });
    items.push({ label: t('orders.reject'), icon: 'fa-times', cls: 'text-danger-700', run: () => onAction(order._id, 'reject', { reason: 'Rejected by admin' }) });
  }
  if (order.status === 'APPROVED') items.push({ label: t('orders.request_payment'), icon: 'fa-money-bill', cls: 'text-primary-700', run: () => onAction(order._id, 'request-payment') });
  if (order.status === 'PENDING_PAYMENT') items.push({ label: t('orders.confirm_payment'), icon: 'fa-check-double', cls: 'text-success-700', run: () => onAction(order._id, 'confirm-payment', { method: 'manual' }) });
  if (order.status === 'PAID') items.push({ label: t('orders.deliver'), icon: 'fa-truck', cls: 'text-primary-700', run: () => onAction(order._id, 'deliver') });
  if (['PAID', 'DELIVERED'].includes(order.status)) {
    items.push({ label: t('orders.receipt'), icon: 'fa-file-pdf', cls: 'text-gray-700', run: () => onReceipt(order._id) });
    items.push({ label: t('orders.send_receipt'), icon: 'fa-paper-plane', cls: 'text-success-700', run: () => onSendReceipt(order._id) });
  }
  items.push({ label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700', run: () => onDelete(order._id) });

  return (
    <div className="relative inline-block text-left">
      <button
        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        disabled={!!actionLoading}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={t('orders.col_actions')}
      >
        <i className="fas fa-ellipsis-v"></i>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }}></div>
          <div className="absolute right-0 z-20 mt-1 w-44 origin-top-right rounded-xl bg-white shadow-lg border border-gray-100 py-1">
            {items.map((it, i) => (
              <button
                key={i}
                disabled={!!actionLoading}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.run(); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium hover:bg-gray-50 transition-colors ${it.cls}`}
              >
                <i className={`fas ${it.icon} w-4 text-center`}></i> {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}