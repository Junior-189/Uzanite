import { useState, useEffect, useRef, useMemo } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { playBeep } from '../utils/beep';
import { imgUrl } from '../utils/imgUrl';
import 'barcode-detector/polyfill';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'code_93', 'itf', 'codabar'];

export default function PosScanner({ products = [], onClose, onSave }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const { user } = useAuth();

  const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const [entryMode, setEntryMode] = useState(isCoarsePointer ? 'scan' : 'manual'); // 'scan' | 'manual'
  const [camError, setCamError] = useState(null);
  const [torchOn, setTorchOn] = useState(false);
  const [items, setItems] = useState([]);
  const [view, setView] = useState('scan'); // 'scan' | 'preview'
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [payment, setPayment] = useState('cash');
  const [notFound, setNotFound] = useState(null);
  const [showManual, setShowManual] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [custom, setCustom] = useState({ name: '', price: '', quantity: '1' });
  const [saving, setSaving] = useState(false);
  const [pulseId, setPulseId] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const cooldownRef = useRef(false);
  const detectorRef = useRef(null);

  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const itemCount = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);

  useEffect(() => {
    if (entryMode === 'scan' && view === 'scan') startCamera();
    else stopCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMode, view]);

  const startCamera = async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      activeRef.current = true;
      if (!('BarcodeDetector' in window)) {
        setCamError(t('scanner.not_supported'));
        return;
      }
      if (!detectorRef.current) detectorRef.current = new BarcodeDetector({ formats: FORMATS });
      loopDetect();
    } catch (err) {
      setCamError(err.name === 'NotAllowedError' ? t('scanner.camera_permission') : t('scanner.camera_error'));
    }
  };

  // Continuous detection loop — never stops after a scan, just debounces.
  const loopDetect = async () => {
    if (!activeRef.current) return;
    animRef.current = requestAnimationFrame(loopDetect);
    if (busyRef.current || cooldownRef.current) return;
    if (!videoRef.current || videoRef.current.readyState < 2) return;
    busyRef.current = true;
    try {
      const codes = await detectorRef.current.detect(videoRef.current);
      if (codes.length) handleScan(codes[0].rawValue);
    } catch {}
    busyRef.current = false;
  };

  const stopCamera = () => {
    activeRef.current = false;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const capabilities = track.getCapabilities?.();
      if (!capabilities?.torch) return;
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {}
  };

  // Short confirmation beep (2x volume) via shared Web Audio util.
  const handleScan = (barcode) => {
    // Wait ~1s after a successful scan before the next one can be recorded.
    cooldownRef.current = true;
    setTimeout(() => { cooldownRef.current = false; }, 1000);
    const code = String(barcode).trim();
    const found = products.find((p) => (p.barcode && String(p.barcode) === code) || String(p._id) === code);
    if (!found) {
      setNotFound(code);
      setTimeout(() => setNotFound((n) => (n === code ? null : n)), 2500);
      showToast(t('scanner.no_product_found'), 'error');
      return;
    }
    addProduct(found);
  };

  const addProduct = (p) => {
    playBeep({ volume: 1.0 });
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.productId === p._id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { uid: p._id, productId: p._id, productName: p.name, price: p.price, quantity: 1, imagePath: p.imagePath, stock: p.stock }];
    });
    setPulseId(p._id);
    setTimeout(() => setPulseId((n) => (n === p._id ? null : n)), 450);
  };

  const addCustomItem = ({ name, price, quantity }) => {
    const nm = String(name || '').trim();
    const pr = Number(price);
    const qty = parseInt(quantity, 10);
    if (!nm) return showToast(t('pos.custom_need_name'), 'error');
    if (isNaN(pr) || pr < 0) return showToast(t('pos.custom_need_price'), 'error');
    const uid = 'custom-' + Date.now();
    playBeep({ volume: 1.0 });
    setItems((prev) => [...prev, { uid, productId: null, productName: nm, price: pr, quantity: isNaN(qty) || qty < 1 ? 1 : qty }]);
    setPulseId(uid);
    setTimeout(() => setPulseId((n) => (n === uid ? null : n)), 450);
  };

  const changeQty = (id, delta) => {
    setItems((prev) => prev.map((i) => (i.uid === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)));
  };
  const setQty = (id, q) => {
    const n = parseInt(q, 10);
    if (isNaN(n) || n < 1) return;
    setItems((prev) => prev.map((i) => (i.uid === id ? { ...i, quantity: n } : i)));
  };
  const removeItem = (id) => setItems((prev) => prev.filter((i) => i.uid !== id));

  const openPreview = () => {
    if (items.length === 0) return showToast(t('orders.error_create'), 'error');
    setView('preview');
  };

  const confirmSave = async () => {
    if (saving) return;
    setSaving(true);
    const payload = {
      items,
      customerName: customer.name.trim(),
      customerPhone: customer.phone.trim(),
      customerEmail: customer.email.trim(),
      total,
      paymentMethod: payment,
    };
    const ok = await onSave(payload);
    setSaving(false);
    if (ok) {
      stopCamera();
      onClose();
    }
  };

  const manualList = useMemo(() => {
    const s = manualSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (!s) return true;
      const name = (p.name || '').toLowerCase();
      const barcode = String(p.barcode || '').toLowerCase();
      return name.includes(s) || barcode.includes(s);
    }).slice(0, 200);
  }, [manualSearch, products]);

  const imgSrc = (p) => imgUrl(p?.imagePath);

  return (
    <div className="fixed inset-0 z-[120] bg-primary-900 flex flex-col text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary-900 border-b border-white/10">
        <div>
          <h2 className="font-semibold text-sm">{t('pos.title')}</h2>
          <p className="text-[11px] text-white/50">{t('pos.scan_hint')}</p>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20">
          <i className="fas fa-times text-sm"></i>
        </button>
      </div>

      {view === 'scan' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Scan / Manual toggle */}
          <div className="flex items-center gap-1 p-1 mx-4 mt-3 bg-white/10 rounded-xl shrink-0 lg:max-w-sm">
            <button
              onClick={() => setEntryMode('scan')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${entryMode === 'scan' ? 'bg-white text-primary-900' : 'text-white/70 hover:text-white'}`}
            >
              <i className="fas fa-barcode mr-1.5"></i> {t('pos.mode_scan')}
            </button>
            <button
              onClick={() => setEntryMode('manual')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${entryMode === 'manual' ? 'bg-white text-primary-900' : 'text-white/70 hover:text-white'}`}
            >
              <i className="fas fa-keyboard mr-1.5"></i> {t('pos.mode_manual')}
            </button>
          </div>

          {/* Two-pane: product source (left) + cart (right) */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 mt-3 gap-0 lg:gap-0">

            {/* LEFT — product source */}
            <div className="flex flex-col overflow-hidden min-h-0 flex-1 lg:border-r lg:border-white/10">
              {/* Manual product picker */}
              {entryMode === 'manual' && (
                <div className="flex flex-col overflow-hidden min-h-0 h-full px-4 pb-3 gap-2.5">
                  <div className="relative shrink-0">
                    <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm"></i>
                    <input
                      value={manualSearch}
                      onChange={(e) => setManualSearch(e.target.value)}
                      placeholder={t('pos.manual_search')}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                    />
                  </div>
                  <p className="text-[11px] text-white/50 px-0.5 shrink-0">
                    {manualSearch.trim() ? t('pos.tap_to_add') : t('pos.all_products', { count: products.length })}
                  </p>
                  <div className="flex-1 min-h-[22vh] overflow-y-auto rounded-xl bg-white lg:grid lg:grid-cols-2 lg:gap-px lg:bg-gray-100 lg:content-start">
                    {manualList.length === 0 && <p className="text-sm text-gray-400 text-center py-6 lg:col-span-2 bg-white">{t('pos.no_products')}</p>}
                    {manualList.map((p) => (
                      <button
                        key={p._id}
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center gap-3 p-2.5 text-left border-b border-gray-50 last:border-0 hover:bg-primary-50 bg-white lg:border-b-0"
                      >
                        <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                          {imgSrc(p) ? <img src={imgSrc(p)} alt={p.name} className="w-full h-full object-cover" /> : <i className="fas fa-box text-gray-300 text-xs"></i>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate font-medium">{p.name}</p>
                          <p className="text-[11px] text-gray-400">{(p.price || 0).toLocaleString()} · {t('pos.qty')}: {p.stock || 0}</p>
                        </div>
                        <i className="fas fa-plus text-primary-600"></i>
                      </button>
                    ))}
                  </div>

                  {/* Custom item — for products not in the catalog */}
                  <div className="shrink-0 rounded-xl bg-white/10 p-3">
                    <p className="text-[11px] font-semibold text-white/70 uppercase tracking-wide mb-2">
                      <i className="fas fa-pen mr-1"></i> {t('pos.custom_title')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={custom.name}
                        onChange={(e) => setCustom({ ...custom, name: e.target.value })}
                        placeholder={t('pos.custom_name')}
                        className="flex-[2] min-w-0 px-3 py-2 rounded-lg bg-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                      />
                      <input
                        value={custom.price}
                        onChange={(e) => setCustom({ ...custom, price: e.target.value })}
                        placeholder={t('pos.custom_price')}
                        inputMode="numeric"
                        className="flex-1 min-w-0 w-16 px-3 py-2 rounded-lg bg-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                      />
                      <input
                        value={custom.quantity}
                        onChange={(e) => setCustom({ ...custom, quantity: e.target.value })}
                        placeholder={t('pos.qty')}
                        inputMode="numeric"
                        className="w-14 shrink-0 px-2 py-2 text-center rounded-lg bg-white/10 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40"
                      />
                      <button
                        onClick={() => { addCustomItem(custom); setCustom({ name: '', price: '', quantity: '1' }); }}
                        className="shrink-0 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Camera */}
              {entryMode === 'scan' && (
                <div className="relative bg-black mx-4 mb-3 rounded-xl overflow-hidden h-[38vh] lg:h-auto lg:flex-1 min-h-0">
                  <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
                  {!camError && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-56 h-56 border-2 border-white/60 rounded-2xl">
                        <div className="absolute top-0 left-0 w-7 h-7 border-t-4 border-l-4 border-primary-400 rounded-tl-lg"></div>
                        <div className="absolute top-0 right-0 w-7 h-7 border-t-4 border-r-4 border-primary-400 rounded-tr-lg"></div>
                        <div className="absolute bottom-0 left-0 w-7 h-7 border-b-4 border-l-4 border-primary-400 rounded-bl-lg"></div>
                        <div className="absolute bottom-0 right-0 w-7 h-7 border-b-4 border-r-4 border-primary-400 rounded-br-lg"></div>
                        <div className="absolute inset-x-0 top-1/2 h-0.5 bg-primary-400/80 animate-scan-line"></div>
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-3 inset-x-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[11px] text-white/70 bg-black/40 px-3 py-1 rounded-full">{t('pos.point_camera')}</span>
                  </div>
                  {!camError && (
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button onClick={toggleTorch} className="w-9 h-9 rounded-full bg-white/15 backdrop-blur flex items-center justify-center">
                        <i className={`fas fa-bolt text-sm ${torchOn ? 'text-yellow-300' : ''}`}></i>
                      </button>
                    </div>
                  )}
                  {camError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
                        <i className="fas fa-camera text-xl text-red-400"></i>
                      </div>
                      <p className="text-sm text-white/80 mb-4">{camError}</p>
                      <button onClick={startCamera} className="bg-primary-600 px-4 py-2 rounded-xl text-sm font-semibold">{t('scanner.retry') || 'Retry'}</button>
                    </div>
                  )}
                  {notFound && (
                    <div className="absolute top-3 left-3">
                      <span className="text-[11px] text-white bg-red-500/90 px-2.5 py-1 rounded-full font-medium">{t('pos.not_found', { barcode: notFound })}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT — cart / selected items */}
            <div className="flex flex-col bg-gray-50 overflow-hidden min-h-0 shrink-0 lg:w-[380px] lg:flex-shrink-0 border-t border-gray-200 lg:border-t-0">
              <div className="flex items-center justify-between px-4 pt-3 pb-1.5 shrink-0">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide"><i className="fas fa-cart-shopping mr-1.5 text-gray-400"></i>{t('pos.items')}</span>
                <span className="text-xs text-gray-400">{t('pos.item_count', { count: itemCount })}</span>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 max-h-[26vh] lg:max-h-none">
                {items.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400">{t('pos.empty')}</div>
                ) : (
                  <div className="px-4 pb-4">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase text-gray-400">
                          <th className="py-2 pr-3 font-semibold">{t('pos.product')}</th>
                          <th className="py-2 px-3 font-semibold text-center">{t('pos.qty')}</th>
                          <th className="py-2 px-3 font-semibold text-right">{t('pos.subtotal')}</th>
                          <th className="py-2 pl-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.uid} className={`border-t border-gray-100 ${pulseId === it.uid ? 'bg-primary-50' : ''}`}>
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-2">
                                <div className="w-9 h-9 rounded-md bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                                  {imgSrc(it) ? (
                                    <img src={imgSrc(it)} alt={it.productName} className="w-full h-full object-cover" />
                                  ) : (
                                    <i className={`fas ${it.productId ? 'fa-box' : 'fa-pen'} text-gray-300 text-xs`}></i>
                                  )}
                                </div>
                                <span className="text-gray-800 font-medium">{it.productName}{!it.productId && <span className="ml-1.5 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{t('pos.custom_tag')}</span>}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-md w-fit mx-auto">
                                <button onClick={() => changeQty(it.uid, -1)} className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 rounded-l-md">
                                  <i className="fas fa-minus text-[10px]"></i>
                                </button>
                                <input
                                  value={it.quantity}
                                  onChange={(e) => setQty(it.uid, e.target.value)}
                                  className="w-8 text-center text-xs font-semibold text-gray-800 bg-transparent focus:outline-none"
                                  inputMode="numeric"
                                />
                                <button onClick={() => changeQty(it.uid, 1)} className="w-6 h-6 flex items-center justify-center text-gray-600 hover:bg-gray-200 rounded-r-md">
                                  <i className="fas fa-plus text-[10px]"></i>
                                </button>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-gray-900">{((it.price || 0) * it.quantity).toLocaleString()}</td>
                            <td className="py-2 pl-2">
                              <button onClick={() => removeItem(it.uid)} className="text-danger-500 hover:bg-danger-50 rounded-md w-6 h-6 flex items-center justify-center">
                                <i className="fas fa-times text-xs"></i>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              <div className="bg-white px-4 py-3 flex items-center gap-3 border-t border-gray-200 shrink-0">
                <div className="flex-1 text-gray-900">
                  <p className="text-[11px] text-gray-400 uppercase">{t('pos.total')}</p>
                  <p className="text-lg font-bold leading-none">{total.toLocaleString()}</p>
                </div>
                <button
                  onClick={openPreview}
                  disabled={items.length === 0}
                  className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <i className="fas fa-receipt mr-1"></i> {t('pos.preview')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'preview' && (
        <div className="flex-1 overflow-y-auto bg-gray-100 px-4 py-4">
          <div className="max-w-sm mx-auto bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="text-center py-4 border-b border-dashed border-gray-200">
              <p className="font-bold tracking-widest text-gray-800">{t('pos.receipt_header')}</p>
              <p className="text-xs text-gray-500 mt-0.5">{user?.businessName || 'UZANITE'}</p>
              <p className="text-[11px] text-gray-400">{new Date().toLocaleString()}</p>
            </div>
            <div className="px-4 py-3 divide-y divide-gray-100">
              {items.map((it) => (
                <div key={it.uid} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex-1 pr-2">
                    <p className="text-gray-800 font-medium leading-tight">{it.productName}</p>
                    <p className="text-[11px] text-gray-400">{it.quantity} × {(it.price || 0).toLocaleString()}</p>
                  </div>
                  <span className="font-semibold text-gray-900">{((it.price || 0) * it.quantity).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-dashed border-gray-200">
              <div className="flex items-center justify-between text-base font-bold text-gray-900">
                <span>{t('pos.total')}</span>
                <span>{total.toLocaleString()}</span>
              </div>
            </div>
            <div className="px-4 pb-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('pos.customer_name')}</label>
                <input
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  placeholder={t('orders.customer_name_placeholder') || 'Walk-in'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('pos.phone_optional')}</label>
                <input
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  placeholder="255..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('pos.email_optional')}</label>
                <input
                  type="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  placeholder="customer@email.com"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('pos.payment_method')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {['cash', 'card', 'mobile_money'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setPayment(m)}
                      className={`py-2 rounded-lg text-xs font-semibold border ${payment === m ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300'}`}
                    >
                      {t(`pos.${m}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className="text-center text-[11px] text-gray-400 mt-3 px-4">{t('pos.scan_more')}</p>
        </div>
      )}

      {/* Footer for preview */}
      {view === 'preview' && (
        <div className="bg-white px-4 py-3 flex items-center gap-3 border-t border-gray-200">
          <button onClick={() => setView('scan')} className="px-4 py-2.5 rounded-xl bg-white text-gray-700 border border-gray-300 text-sm font-medium hover:bg-gray-50">
            <i className="fas fa-arrow-left mr-1"></i> {t('pos.back')}
          </button>
          <button
            onClick={confirmSave}
            disabled={saving || items.length === 0}
            className="flex-1 px-5 py-2.5 rounded-xl bg-success-600 text-white text-sm font-semibold hover:bg-success-700 disabled:opacity-50"
          >
            {saving ? <i className="fas fa-spinner fa-spin"></i> : <><i className="fas fa-check mr-1"></i> {t('pos.confirm_save')}</>}
          </button>
        </div>
      )}

      {/* Manual add modal */}
      {showManual && (
        <div className="absolute inset-0 z-[130] bg-black/60 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-4 shadow-xl text-gray-900">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">{t('pos.manual_title')}</h3>
              <button onClick={() => { setShowManual(false); setManualSearch(''); }} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                <i className="fas fa-times text-sm text-gray-500"></i>
              </button>
            </div>
            <input
              autoFocus
              value={manualSearch}
              onChange={(e) => setManualSearch(e.target.value)}
              placeholder={t('pos.manual_search')}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {manualList.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{t('pos.no_products')}</p>}
              {manualList.map((p) => (
                <button
                  key={p._id}
                  onClick={() => { addProduct(p); setShowManual(false); setManualSearch(''); }}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                    {imgSrc(p) ? <img src={imgSrc(p)} alt={p.name} className="w-full h-full object-cover" /> : <i className="fas fa-box text-gray-300 text-xs"></i>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-400">{(p.price || 0).toLocaleString()} · {t('pos.qty')}: {p.stock || 0}</p>
                  </div>
                  <i className="fas fa-plus text-primary-600"></i>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
