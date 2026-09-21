import { useState, useEffect, useRef } from 'react';
import { confirmDialog, promptDialog } from '../utils/dialog';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import StatCard from '../components/StatCard';
import PeriodFilter from '../components/PeriodFilter';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import BarcodeScanner from '../components/BarcodeScanner';
import ReportPeriodModal, { downloadReport } from '../components/ReportPeriodModal';
import { playBeep } from '../utils/beep';
import { fetchFromCacheOrApi, createOffline, updateOffline, deleteOffline } from '../db/helpers';
import { imgUrl } from '../utils/imgUrl';
import JsBarcode from 'jsbarcode';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { getAccessToken } from '../utils/tokenStore';
import { rowActivate } from '../utils/rowActivate';
import { isRoutedToPlatform } from '../utils/apiRouting';
import { uploadFile } from '../utils/files';

const API_URL = import.meta.env.VITE_API_URL || '/api';

export default function Products() {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const { isOnline } = useOnlineStatus();
  const fileRef = useRef();
  const csvRef = useRef();
  const barcodeSvgRef = useRef(null);

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [form, setForm] = useState({ name: '', price: '', description: '', stock: '', cost: '', minPrice: '', currency: 'TZS', barcode: '', expiryDate: '', expiryWarnDays: 7 });
  const [imageFile, setImageFile] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [period, setPeriod] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [showScanner, setShowScanner] = useState(false);
  const [scanMode, setScanMode] = useState('restock');
  const [restockItem, setRestockItem] = useState(null);
  const [restockExpiry, setRestockExpiry] = useState('');
  const [restockQty, setRestockQty] = useState('');
  const [showRestockModal, setShowRestockModal] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  const openDetail = (product) => {
    setDetailProduct(product);
    setShowDetail(true);
  };

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const items = await fetchFromCacheOrApi('products', { forceRefresh });
      setProducts(items);
    } catch (err) { showToast(err?.error || err?.message || t('products.failed_to_load'), 'error'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('description', form.description);
      fd.append('price', Number(form.price));
      fd.append('currency', form.currency);
      fd.append('stock', Number(form.stock || 0));
      fd.append('cost', Number(form.cost || 0));
      fd.append('minPrice', Number(form.minPrice || 0));
      fd.append('barcode', form.barcode || '');
      fd.append('expiryDate', form.expiryDate || '');
      fd.append('expiryWarnDays', Number(form.expiryWarnDays || 7));
      if (imageFile) fd.append('image', imageFile);
      fd.append('clientRef', crypto.randomUUID());

      const productId = editProduct?._id || editProduct?.id;
      if (navigator.onLine && isRoutedToPlatform('/products')) {
        const payload = {
          name: form.name,
          description: form.description,
          price: Number(form.price),
          currency: form.currency,
          stock: Number(form.stock || 0),
          cost: Number(form.cost || 0),
          minPrice: Number(form.minPrice || 0),
          barcode: form.barcode || null,
          expiryDate: form.expiryDate || null,
          expiryWarnDays: Number(form.expiryWarnDays || 7),
          clientRef: crypto.randomUUID(),
        };
        if (imageFile) {
          const uploaded = await uploadFile(imageFile, 'product_image');
          payload.imageKey = uploaded.key;
        }
        const json = editProduct
          ? await api.put(`/products/${productId}`, payload)
          : await api.post('/products', payload);
        if (!json.success) throw new Error(json.error || t('products.failed_save'));
        showToast(editProduct ? t('products.confirmed_updated') : t('products.confirmed_created'), 'success');
      } else if (navigator.onLine) {
        const token = getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const url = productId ? `${API_URL}/products/${productId}` : `${API_URL}/products`;
        const res = await fetch(url, { method: editProduct ? 'PUT' : 'POST', headers, body: fd });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || t('products.failed_save'));
        showToast(editProduct ? t('products.confirmed_updated') : t('products.confirmed_created'), 'success');
      } else {
        if (editProduct) {
          await updateOffline('products', editProduct._id || editProduct.id, {
            name: form.name, price: Number(form.price), description: form.description,
            stock: Number(form.stock || 0), cost: Number(form.cost || 0),
            minPrice: Number(form.minPrice || 0), currency: form.currency,
            barcode: form.barcode || null,
            expiryDate: form.expiryDate || null, expiryWarnDays: Number(form.expiryWarnDays || 7),
          });
          showToast(t('products.confirmed_updated'), 'success');
        } else {
          await createOffline('products', {
            name: form.name, price: Number(form.price), description: form.description,
            stock: Number(form.stock || 0), cost: Number(form.cost || 0),
            minPrice: Number(form.minPrice || 0), currency: form.currency,
            barcode: form.barcode || null,
            expiryDate: form.expiryDate || null, expiryWarnDays: Number(form.expiryWarnDays || 7),
            imageBlob: imageFile || null,
          });
          showToast(t('products.confirmed_offline'), 'success');
        }
      }
      setShowForm(false); setEditProduct(null); setImageFile(null);
      setForm({ name: '', price: '', description: '', stock: '', cost: '', minPrice: '', currency: 'TZS', barcode: '', expiryDate: '', expiryWarnDays: 7 });
      if (fileRef.current) fileRef.current.value = '';
      fetchProducts(true);
    } catch (err) { showToast(err.error || err.message || t('products.failed_save'), 'error'); }
  };

  const handleDelete = async (id, name) => {
    if (!(await confirmDialog(t('products.confirm_delete', { name })))) return;
    try {
      await deleteOffline('products', id);
      showToast(t('products.confirmed_deleted'), 'success');
      fetchProducts(true);
    } catch { showToast(t('common.failed'), 'error'); }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    if (!csvFile) return;
    const fd = new FormData();
    fd.append('file', csvFile);
    try {
      const res = await api.post('/products/bulk', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      showToast(res.message || t('products.confirmed_import'), 'success');
      setShowImport(false);
      setCsvFile(null);
      if (csvRef.current) csvRef.current.value = '';
      fetchProducts();
    } catch (err) {
      showToast(err.error || t('products.failed_import'), 'error');
    }
  };

  const escapeHtml = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const printBarcode = (name, barcode) => {
    if (!barcode) {
      showToast(t('products.barcode_placeholder'), 'error');
      return;
    }
    try {
      JsBarcode(barcodeSvgRef.current, barcode, { format: 'CODE128', width: 2, height: 55, displayValue: true, fontSize: 16, textMargin: 4, margin: 0 });
    } catch {
      showToast(t('products.barcode_placeholder'), 'error');
      return;
    }
    const svgHtml = barcodeSvgRef.current.outerHTML;
    const win = window.open('', '_blank');
    if (!win) {
      showToast(t('products.allow_popup'), 'error');
      return;
    }
    win.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Barcode</title>' +
      '<style>@page{margin:6mm;}body{font-family:Arial,sans-serif;margin:0;}' +
      '.label{width:280px;margin:0 auto;text-align:center;}' +
      '.nm{font-weight:bold;font-size:15px;margin-bottom:6px;word-break:break-word;}' +
      '.bc{display:flex;justify-content:center;}</style></head><body>' +
      '<div class="label"><div class="nm">' + escapeHtml(name || '') + '</div>' +
      '<div class="bc">' + svgHtml + '</div>' +
      '</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
      '</body></html>'
    );
    win.document.close();
  };

  const openEdit = (p) => {
    setEditProduct(p);
    setForm({
      name: p.name,
      price: p.price || '',
      description: p.description || '',
      stock: p.stock || '',
      cost: p.cost || '',
      minPrice: p.minPrice || '',
      currency: p.currency || 'TZS',
      barcode: p.barcode || '',
      expiryDate: p.expiryDate ? new Date(p.expiryDate).toISOString().split('T')[0] : '',
      expiryWarnDays: p.expiryWarnDays ?? 7,
    });
    setShowForm(true);
  };

  const handleScanForRestock = (barcode) => {
    setShowScanner(false);
    playBeep({ volume: 1.0 });
    const found = products.find(p => p.barcode === barcode);
    if (found) {
      setRestockItem(found);
      setRestockQty('');
      setShowRestockModal(true);
    } else {
      setForm({ name: '', price: '', description: '', stock: '0', cost: '', minPrice: '', currency: 'TZS', barcode: barcode, expiryDate: '', expiryWarnDays: 7 });
      setEditProduct(null);
      setShowForm(true);
      showToast(t('scanner.no_product_found_adding'), 'info');
    }
  };

  const handleScanForField = (barcode) => {
    setShowScanner(false);
    playBeep({ volume: 1.0 });
    setForm({ ...form, barcode });
  };

  const submitRestock = async () => {
    if (!restockItem || !restockQty || Number(restockQty) <= 0) return;
    try {
      await api.post(`/products/${restockItem._id}/restock`, { quantity: Number(restockQty), expiryDate: restockExpiry || '' });
      showToast(t('scanner.restocked'), 'success');
      setShowRestockModal(false);
      setRestockItem(null);
      setRestockQty('');
      setRestockExpiry('');
      fetchProducts(true);
    } catch (err) {
      showToast(err.error || t('common.failed'), 'error');
    }
  };

  const baseFiltered = products.filter((p) => {
    if (search && !(p.name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (period !== 'all' && p.createdAt) {
      const d = new Date(p.createdAt);
      const now = new Date();
      if (period === 'daily' && d < new Date(now - 86400000)) return false;
      if (period === 'weekly' && d < new Date(now - 7 * 86400000)) return false;
      if (period === 'monthly' && d < new Date(now.getFullYear(), now.getMonth(), 1)) return false;
      if (period === 'annually' && d < new Date(now.getFullYear(), 0, 1)) return false;
    }
    return true;
  });

  const stockMatch = (p) => {
    const s = p.stock || 0;
    if (stockFilter === 'in') return s > 0;
    if (stockFilter === 'low') return s > 0 && s <= (p.lowStockThreshold || 5);
    if (stockFilter === 'out') return s <= 0;
    return true;
  };

  const filtered = baseFiltered.filter(stockMatch);

  const stockBadge = (p) => {
    const s = p.stock || 0;
    if (s <= 0) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-danger-50 text-danger-700 border border-danger-200"><i className="fas fa-times-circle"></i> {t('products.out_of_stock')}</span>;
    }
    if (s <= (p.lowStockThreshold || 5)) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-warning-50 text-warning-700 border border-warning-200"><i className="fas fa-exclamation-triangle"></i> {t('products.low_stock')}</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-success-50 text-success-700 border border-success-200"><i className="fas fa-check-circle"></i> {t('products.in_stock')}</span>;
  };

  const totalProducts = baseFiltered.length;
  const inStock = baseFiltered.filter((p) => (p.stock || 0) > 0).length;
  const lowStock = baseFiltered.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= (p.lowStockThreshold || 5)).length;
  const outOfStock = baseFiltered.filter((p) => !p.stock || p.stock <= 0).length;
  const invValue = baseFiltered.reduce((s, p) => s + (p.price || 0) * Math.max(p.stock || 0, 0), 0);

  return (
    <div className="space-y-6">
      {/* Hidden SVG used to render barcodes for printing */}
      <svg ref={barcodeSvgRef} xmlns="http://www.w3.org/2000/svg" style={{ display: 'none' }} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i className="fas fa-tag text-primary-500"></i> {t('products.title')}
          </h1>
          {!isOnline && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-warning-100 text-warning-700 text-xs font-semibold border border-warning-200">
              <i className="fas fa-wifi-slash"></i> {t('products.offline')}
            </span>
          )}
          <p className="text-sm text-gray-500 mt-1">{t('products.count', { count: filtered.length })}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
            onClick={() => setShowReportModal(true)}
          >
            <i className="fas fa-file-pdf mr-1"></i> {t('products.report')}
          </button>
          <button
            className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
            onClick={() => setShowImport(true)}
          >
            <i className="fas fa-file-csv mr-1"></i> {t('products.import_csv')}
          </button>
          <button
            className="bg-emerald-600 text-white hover:bg-emerald-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            onClick={() => { setScanMode('restock'); setShowScanner(true); }}
          >
            <i className="fas fa-barcode mr-1"></i> {t('scanner.scan_to_restock')}
          </button>
          <button
            className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold"
            onClick={() => {
              setEditProduct(null);
      setForm({ name: '', price: '', description: '', stock: '', cost: '', minPrice: '', currency: 'TZS', barcode: '', expiryDate: '', expiryWarnDays: 7 });
              setImageFile(null);
              setShowForm(true);
            }}
          >
            <i className="fas fa-plus mr-1"></i> {t('products.add_product')}
          </button>
        </div>
      </div>

      {/* Period Filter */}
      <PeriodFilter value={period} onChange={setPeriod} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon="fa-box" color="blue" value={totalProducts} label={t('products.stat_total')} onClick={() => setStockFilter('all')} active={stockFilter === 'all'} />
        <StatCard icon="fa-check-circle" color="green" value={inStock} label={t('products.stat_in_stock')} onClick={() => setStockFilter('in')} active={stockFilter === 'in'} />
        <StatCard icon="fa-exclamation-triangle" color="yellow" value={lowStock} label={t('products.stat_low_stock')} onClick={() => setStockFilter('low')} active={stockFilter === 'low'} />
        <StatCard icon="fa-times-circle" color="red" value={outOfStock} label={t('products.stat_out_of_stock')} onClick={() => setStockFilter('out')} active={stockFilter === 'out'} />
        <StatCard icon="fa-coins" color="green" value={invValue} label={t('products.stat_inventory_value')} onClick={() => setStockFilter('all')} active={stockFilter === 'all'} />
      </div>

      {/* Search */}
      <div className="max-w-md">
        <SearchInput value={search} onChange={setSearch} placeholder={t('search.placeholder')} />
      </div>

      {/* Import CSV Panel */}
      {showImport && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-success-600 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <i className="fas fa-file-csv text-success-600"></i> {t('products.import_csv')}
          </h3>
          <form onSubmit={handleImport} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.csv_file')}</label>
              <input
                type="file"
                accept=".csv"
                ref={csvRef}
                onChange={(e) => setCsvFile(e.target.files[0])}
                required
                className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
              <small className="text-gray-400 text-xs mt-1 block">{t('products.csv_hint')}</small>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => setShowImport(false)}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">
                {t('products.import')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add/Edit Product Panel */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-primary-500 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">
            {editProduct ? t('products.edit_product') : t('products.add_product')}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.name')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.price')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.barcode')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder={t('products.barcode_placeholder')}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                  />
                  <button type="button" onClick={() => { setScanMode('field'); setShowScanner(true); }}
                    className="px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium transition-colors">
                    <i className="fas fa-barcode"></i>
                  </button>
                  <button type="button" onClick={() => printBarcode(form.name, form.barcode)}
                    className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium whitespace-nowrap transition-colors">
                    <i className="fas fa-print mr-1"></i> {t('products.print')}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.min_price')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.minPrice}
                  onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
                <small className="text-gray-400 text-xs mt-1 block">{t('products.min_price_hint')}</small>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.expiry_date')}</label>
                <input
                  type="date"
                  value={form.expiryDate}
                  onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.expiry_warn_days')}</label>
                <input
                  type="number"
                  min="0"
                  value={form.expiryWarnDays}
                  onChange={(e) => setForm({ ...form, expiryWarnDays: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.cost_price')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.cost}
                  onChange={(e) => setForm({ ...form, cost: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.stock')}</label>
                <input
                  type="number"
                  min="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.currency')}</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors bg-white"
                >
                  {['TZS', 'KES', 'UGX', 'USD'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.image')}</label>
              <input
                type="file"
                accept="image/*"
                ref={fileRef}
                onChange={(e) => setImageFile(e.target.files[0])}
                className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors px-4 py-2 rounded-xl text-sm font-medium"
                onClick={() => { setShowForm(false); setEditProduct(null); }}
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold">
                {editProduct ? t('common.update') : t('products.create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin"></div>
          <p className="text-gray-500 text-sm">{t('products.loading')}</p>
        </div>
      ) : filtered.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center">
            <i className="fas fa-tag text-3xl text-gray-300"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{t('products.no_products')}</h3>
          <p className="text-gray-500 text-sm">{t('products.no_products_hint')}</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/50">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_product')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_price')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_stock')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_status')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_value')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_recorded_by')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.expiry_date')}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('products.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((product) => (
                    <tr
                      key={product._id}
                      {...rowActivate(() => openDetail(product), { label: product.name })}
                      className="cursor-pointer transition-colors hover:bg-gray-50/50"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                            {product.imagePath ? (
                              <img
                                className="w-full h-full object-cover"
                                src={imgUrl(product.imagePath)}
                                alt={product.name}
                                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                              />
                            ) : null}
                            <div className={`${product.imagePath ? 'hidden' : 'flex'} items-center justify-center w-full h-full`}>
                              <i className="fas fa-box text-gray-300"></i>
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{product.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{product.currency || 'TZS'} {(product.price || 0).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{product.stock || 0}</td>
                      <td className="px-5 py-3.5">{stockBadge(product)}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-700">{((product.price || 0) * Math.max(product.stock || 0, 0)).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{product.recordedBy || 'Owner'}</td>
                      <ExpiryCell date={product.expiryDate} warnDays={product.expiryWarnDays} t={t} />
                      <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <ProductActionsMenu
                          product={product}
                          t={t}
                          onView={openDetail}
                          onEdit={openEdit}
                          onRestock={(p) => { setRestockItem(p); setRestockExpiry(p.expiryDate ? new Date(p.expiryDate).toISOString().split('T')[0] : ''); setShowRestockModal(true); }}
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
            {filtered.map((product) => (
              <div key={product._id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4" {...rowActivate(() => openDetail(product))}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                    {product.imagePath ? (
                      <img
                        className="w-full h-full object-cover"
                        src={imgUrl(product.imagePath)}
                        alt={product.name}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                    ) : null}
                    <div className={`${product.imagePath ? 'hidden' : 'flex'} items-center justify-center w-full h-full`}>
                      <i className="fas fa-box text-gray-300"></i>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-gray-900 truncate">{product.name}</div>
                    <div className="text-sm text-primary-600 font-semibold">{product.currency || 'TZS'} {(product.price || 0).toLocaleString()}</div>
                  </div>
                  {stockBadge(product)}
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>{t('products.stock_label')} {product.stock || 0}</span>
                  <span>{t('products.col_value')}: {((product.price || 0) * Math.max(product.stock || 0, 0)).toLocaleString()}</span>
                </div>
                <div className="text-xs text-gray-500 mb-3"><i className="fas fa-user mr-1 text-gray-400"></i>{t('products.col_recorded_by')}: <strong className="text-gray-700">{product.recordedBy || 'Owner'}</strong></div>
                <ExpiryCell date={product.expiryDate} warnDays={product.expiryWarnDays} t={t} inline />
                <div className="flex items-center gap-2" role="presentation" onClick={(e) => e.stopPropagation()}>
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors" onClick={() => openDetail(product)} title={t('products.view')}>
                    <i className="fas fa-eye"></i>
                  </button>
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors" onClick={() => openEdit(product)}>
                    <i className="fas fa-pen"></i>
                  </button>
                  <button className="text-xs px-2.5 py-1.5 rounded-lg font-medium bg-danger-600 text-white hover:bg-danger-700 transition-colors" onClick={() => handleDelete(product._id, product.name)}>
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Restock Modal */}
      {showRestockModal && restockItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" {...rowActivate(() => setShowRestockModal(false))}></div>
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('scanner.restock_title')}</h3>
            <p className="text-sm text-gray-500 mb-4">{restockItem.name}</p>
            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <div className="text-xs text-gray-500">{t('products.stock')}</div>
              <div className="text-xl font-bold text-gray-900">{restockItem.stock || 0}</div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('scanner.restock_qty')}</label>
              <input type="number" min="1" value={restockQty} onChange={(e) => setRestockQty(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" autoFocus />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.expiry_date')}</label>
              <input type="date" value={restockExpiry} onChange={(e) => setRestockExpiry(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setShowRestockModal(false); setRestockExpiry(''); }} className="flex-1 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium">{t('common.cancel')}</button>
              <button onClick={submitRestock} disabled={!restockQty || Number(restockQty) <= 0} className="flex-1 bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{t('scanner.restock_button')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      <Modal open={showDetail} onClose={() => setShowDetail(false)} title={t('products.details')}
        footer={detailProduct && (
          <>
              <button onClick={() => { setShowDetail(false); setRestockItem(detailProduct); setRestockExpiry(detailProduct.expiryDate ? new Date(detailProduct.expiryDate).toISOString().split('T')[0] : ''); setShowRestockModal(true); }}
              className="px-4 py-2 rounded-xl bg-white text-gray-700 border border-gray-300 text-sm font-medium hover:bg-gray-50 transition-colors">
              <i className="fas fa-plus mr-1.5"></i>{t('products.restock')}
            </button>
            <button onClick={() => { setShowDetail(false); openEdit(detailProduct); }}
              className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors">
              <i className="fas fa-pen mr-1.5"></i>{t('common.edit')}
            </button>
          </>
        )}
      >
        {detailProduct && (() => {
          const cur = detailProduct.currency || 'TZS';
          const price = detailProduct.price || 0;
          const cost = detailProduct.cost || 0;
          const stock = detailProduct.stock || 0;
          const profit = price - cost;
          const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
          const invValue = price * Math.max(stock, 0);
          return (
          <div>
            <div className="relative h-52 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center overflow-hidden mb-4">
              {detailProduct.imagePath ? (
                <img src={imgUrl(detailProduct.imagePath)} alt={detailProduct.name} className="w-full h-full object-cover" />
              ) : (
                <i className="fas fa-box text-6xl text-gray-300"></i>
              )}
              <div className="absolute top-3 right-3">{stockBadge(detailProduct)}</div>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-xl font-bold text-gray-900 break-words">{detailProduct.name}</h4>
                {detailProduct.barcode && (
                  <div className="text-xs text-gray-400 mt-0.5"><i className="fas fa-barcode mr-1"></i>{detailProduct.barcode}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-extrabold text-primary-600 leading-none">{price.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-0.5">{cur}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{t('products.description_label')}</div>
              <p className="text-sm text-gray-700 whitespace-pre-line">{detailProduct.description || <span className="text-gray-400 italic">{t('products.no_description')}</span>}</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-[11px] text-gray-500 mb-0.5">{t('products.cost_price')}</div>
                <div className="text-base font-bold text-gray-900">{cost.toLocaleString()}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-[11px] text-gray-500 mb-0.5">{t('products.profit_per_unit')}</div>
                <div className={`text-base font-bold ${profit >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{profit.toLocaleString()}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-[11px] text-gray-500 mb-0.5">{t('products.margin')}</div>
                <div className={`text-base font-bold ${margin >= 0 ? 'text-success-600' : 'text-danger-600'}`}>{margin}%</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <div className="text-[11px] text-gray-500 mb-0.5">{t('products.stock')}</div>
                <div className="text-base font-bold text-gray-900">{stock}</div>
              </div>
            </div>

            <div className="mt-4 divide-y divide-gray-100 text-sm rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.col_value')}</span><span className="font-semibold text-gray-900">{cur} {invValue.toLocaleString()}</span></div>
              {detailProduct.minPrice > 0 && (
                <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.min_price')}</span><span className="font-medium text-gray-900">{cur} {detailProduct.minPrice.toLocaleString()}</span></div>
              )}
              <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.low_stock_threshold')}</span><span className="font-medium text-gray-900">{detailProduct.lowStockThreshold ?? 5}</span></div>
              <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.col_recorded_by')}</span><span className="font-medium text-gray-900">{detailProduct.recordedBy || 'Owner'}</span></div>
              {detailProduct.expiryDate && (
                <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.expiry_date')}</span><ExpiryCell date={detailProduct.expiryDate} warnDays={detailProduct.expiryWarnDays} t={t} /></div>
              )}
              {detailProduct.createdAt && (
                <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.created')}</span><span className="font-medium text-gray-900">{new Date(detailProduct.createdAt).toLocaleDateString()}</span></div>
              )}
              {detailProduct.updatedAt && (
                <div className="flex justify-between px-3.5 py-2.5"><span className="text-gray-500">{t('products.updated')}</span><span className="font-medium text-gray-900">{new Date(detailProduct.updatedAt).toLocaleDateString()}</span></div>
              )}
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Barcode Scanner */}
      {showScanner && (
        <BarcodeScanner
          onScan={scanMode === 'restock' ? handleScanForRestock : handleScanForField}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Report Period Modal */}
      <ReportPeriodModal open={showReportModal} onClose={() => setShowReportModal(false)} onSelect={(p) => downloadReport('products', 'products-report.pdf', p)} lang={lang} />
    </div>
  );
}

function ProductActionsMenu({ product, t, onView, onEdit, onRestock, onDelete }) {
  const [open, setOpen] = useState(false);
  const items = [
    { label: t('products.view'), icon: 'fa-eye', cls: 'text-gray-700', run: () => onView(product) },
    { label: t('common.edit'), icon: 'fa-pen', cls: 'text-gray-700', run: () => onEdit(product) },
    { label: t('scanner.restock_button'), icon: 'fa-plus', cls: 'text-primary-700', run: () => onRestock(product) },
    { label: t('common.delete'), icon: 'fa-trash', cls: 'text-danger-700', run: () => onDelete(product._id, product.name) },
  ];

  return (
    <div className="relative inline-block text-left">
      <button
        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={t('products.col_actions')}
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



function ExpiryCell({ date, warnDays = 7, t, inline = false }) {
  if (!date) {
    if (inline) return null;
    return <td className="px-5 py-3.5 text-sm text-gray-300">-</td>;
  }
  const d = new Date(date);
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - todayMid) / 86400000);
  const state = diff < 0 ? 'expired' : diff <= warnDays ? 'near' : null;
  const wrap = inline ? 'mb-3 text-xs text-gray-500' : '';
  const cls = state === 'expired' ? 'text-danger-600 font-semibold' : state === 'near' ? 'text-warning-600 font-semibold' : 'text-gray-700';
  const label = state === 'expired' ? t('products.expired') : state === 'near' ? t('products.expiring_soon') : '';
  return (
    <span className={wrap}>
      <span className={cls}>{d.toLocaleDateString()}</span>
      {label && <span className={`ml-1 text-[10px] ${cls}`}> - {label}</span>}
    </span>
  );
}
