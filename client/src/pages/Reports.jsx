import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import PeriodFilter from '../components/PeriodFilter';
import { getAccessToken } from '../utils/tokenStore';
import { resolveApiUrl } from '../utils/apiRouting';
import { rowActivate } from '../utils/rowActivate';

const reports = [
  { key: 'orders', icon: 'fa-clipboard-list', softBg: 'bg-blue-50', softText: 'text-blue-600', labelKey: 'orders.title', labelSw: 'Maagizo' },
  { key: 'products', icon: 'fa-tag', softBg: 'bg-purple-50', softText: 'text-purple-600', labelKey: 'products.title', labelSw: 'Bidhaa' },
  { key: 'expenses', icon: 'fa-receipt', softBg: 'bg-orange-50', softText: 'text-orange-600', labelKey: 'expenses.title', labelSw: 'Gharama' },
  { key: 'purchases', icon: 'fa-shopping-cart', softBg: 'bg-teal-50', softText: 'text-teal-600', labelKey: 'purchase.title', labelSw: 'Manunuzi' },
  { key: 'debts', icon: 'fa-hand-holding-usd', softBg: 'bg-red-50', softText: 'text-red-600', labelKey: 'debts.title', labelSw: 'Madeni' },
  { key: 'staff', icon: 'fa-users', softBg: 'bg-indigo-50', softText: 'text-indigo-600', labelKey: 'staff.title', labelSw: 'Wafanyakazi' },
];

const periodNameMap = {
  daily: 'period.today',
  weekly: 'period.week',
  monthly: 'period.month',
  annually: 'period.year',
  all: 'period.all_time',
};

const RECENT_KEY = 'uzer_recent_reports';
const formatMoney = (v) => (v || 0).toLocaleString();

function fmtDate(d) {
  const date = (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Date(d + 'T00:00:00') : new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildParams(type, lang) {
  const p = new URLSearchParams({ period: type });
  if (lang === 'sw') p.set('lang', 'sw');
  return p.toString();
}

function triggerCsvDownload(url, filename) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + (getAccessToken() || ''));
  xhr.responseType = 'blob';
  xhr.onload = function () {
    if (xhr.status === 200) {
      const blob = new Blob([xhr.response], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  };
  xhr.send();
}

function triggerPdfDownload(url, filename) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + (getAccessToken() || ''));
  xhr.responseType = 'blob';
  xhr.onload = function () {
    if (xhr.status === 200) {
      const blob = new Blob([xhr.response], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }
  };
  xhr.send();
}

function metricPrimary(key, m, isSw) {
  if (!m) return '—';
  const lbl = {
    orders: isSw ? 'maagizo' : 'orders',
    products: isSw ? 'bidhaa' : 'products',
    expenses: isSw ? 'maingizo' : 'entries',
    purchases: isSw ? 'manunuzi' : 'purchases',
    debts: isSw ? 'madeni' : 'debts',
    staff: isSw ? 'wanachama' : 'members',
  };
  return `${m.count} ${lbl[key] || ''}`;
}

function metricSub(key, m, isSw) {
  if (!m) return '';
  switch (key) {
    case 'orders': return `${formatMoney(m.revenue)} ${isSw ? 'mapato' : 'revenue'}`;
    case 'products': return `${formatMoney(m.value)} ${isSw ? 'hesabu ya bidhaa' : 'inventory'}`;
    case 'expenses': return `${formatMoney(m.total)} ${isSw ? 'imetumika' : 'spent'}`;
    case 'purchases': return `${formatMoney(m.total)} ${isSw ? 'imetumika' : 'spent'}`;
    case 'debts': return `${formatMoney(m.remaining)} ${isSw ? 'imesalia' : 'remaining'}`;
    case 'staff': return `${isSw ? 'timu ya' : 'team of'} ${m.count}`;
    default: return '';
  }
}

export default function Reports() {
  const { lang, t } = useLang();
  const { showToast } = useToast();

  const [rangeType, setRangeType] = useState('monthly');
  const [metrics, setMetrics] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [heroFormat, setHeroFormat] = useState('pdf');
  const [preview, setPreview] = useState(null);
  const [recent, setRecent] = useState([]);

  const isSw = lang === 'sw';
  const title = t('reports.title');
  const subtitle = t('reports.subtitle');
  const fullLabel = t('reports.full_label');
  const fullDesc = t('reports.full_desc');
  const recentLabel = t('reports.recent');
  const scopeLabel = t('reports.scope', { count: reports.length });

  const rangeLabel = t(periodNameMap[rangeType] || 'period.all_time');

  const loadRecent = useCallback(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  useEffect(() => {
    let active = true;
    const params = buildParams(rangeType);
    api.get(`/reports/summary?${params}`)
      .then((res) => { if (active && res.success) setMetrics(res.metrics); })
      .catch(() => {});
    return () => { active = false; };
  }, [rangeType]);

  const addRecent = (entry) => {
    const next = [entry, ...recent.filter((r) => !(r.key === entry.key && r.format === entry.format && r.period === entry.period))].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  };

  const doDownload = (key, format, label) => {
    const baseName = key === 'full' ? 'full-report' : `${key}-report`;
    const endpoint = key === 'full' ? 'full' : key;
    const params = buildParams(rangeType, lang);
    setDownloading(key);
    if (format === 'csv') {
      triggerCsvDownload(resolveApiUrl(`/reports/${endpoint}/csv?${params}`), `${baseName}.csv`);
      addRecent({ key, label, format, period: rangeType, csvData: null });
      setTimeout(() => setDownloading(null), 1200);
    } else {
      triggerPdfDownload(resolveApiUrl(`/reports/${endpoint}?${params}`), `${baseName}.pdf`);
      addRecent({ key, label, format, period: rangeType, csvData: null });
      setTimeout(() => setDownloading(null), 1200);
    }
  };

  const redownload = (entry) => {
    const params = buildParams(entry.period, lang);
    const endpoint = entry.key === 'full' ? 'full' : entry.key;
    const baseName = entry.key === 'full' ? 'full-report' : entry.key + '-report';
    if (entry.format === 'csv') {
      triggerCsvDownload(resolveApiUrl(`/reports/${endpoint}/csv?${params}`), `${baseName}.csv`);
      return;
    }
    triggerPdfDownload(resolveApiUrl(`/reports/${endpoint}?${params}`), `${baseName}.pdf`);
  };

  const formatBtn = (fmt, label) => (
    <button
      onClick={() => setHeroFormat(fmt)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${heroFormat === fmt ? 'bg-white text-primary-700' : 'text-white/80 hover:bg-white/15'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold mb-3">
            <i className="fas fa-chart-bar"></i>
            {t('reports.analytics')}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{subtitle}</p>
        </div>

        {/* Date range selector — same PeriodFilter used by Orders/Products/etc. */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6">
          <PeriodFilter value={rangeType} onChange={setRangeType} />
        </div>

        {/* Full Report hero */}
        <div className="group flex flex-col sm:flex-row sm:items-center gap-5 p-6 rounded-3xl bg-gradient-to-r from-primary-600 to-emerald-600 text-white shadow-lg shadow-emerald-600/10 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-2xl flex-shrink-0">
            <i className="fas fa-layer-group"></i>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold">{fullLabel}</p>
            <p className="text-sm text-white/80 mt-0.5">{fullDesc}</p>
            <p className="text-xs text-white/70 mt-2">
              {scopeLabel} • {rangeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="flex items-center bg-white/15 rounded-xl p-1">
              {formatBtn('pdf', 'PDF')}
              {formatBtn('csv', t('reports.excel'))}
            </div>
            <button
              onClick={() => doDownload('full', heroFormat, fullLabel)}
              disabled={downloading === 'full'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-primary-700 text-sm font-semibold hover:bg-emerald-50 transition-colors disabled:opacity-70"
            >
              {downloading === 'full' ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-download"></i>}
              {t('reports.download')}
            </button>
          </div>
        </div>

        {/* Secondary report cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => {
            const m = metrics?.[report.key];
            const label = isSw ? report.labelSw : t(report.labelKey);
            const isLoading = downloading === report.key;
            return (
              <div
                key={report.key}
                onClick={() => setPreview(report)}
                className="group flex items-center gap-4 p-5 bg-white rounded-2xl border border-gray-100 hover:border-emerald-200 hover:shadow-lg transition-all duration-200 cursor-pointer"
              >
                <div className={`w-12 h-12 rounded-xl ${report.softBg} ${report.softText} flex items-center justify-center text-lg flex-shrink-0`}>
                  <i className={`fas ${report.icon}`}></i>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-gray-900">{label}</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5 truncate">{metricPrimary(report.key, m, isSw)}</p>
                  <p className="text-xs text-gray-400 truncate">{metricSub(report.key, m, isSw)}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); doDownload(report.key, 'pdf', label); }}
                  disabled={isLoading}
                  aria-label={`Download ${label} PDF`}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary-600 hover:bg-gray-100 transition-colors flex-shrink-0 disabled:opacity-60"
                >
                  {isLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-download"></i>}
                </button>
              </div>
            );
          })}
        </div>

        {/* Recent Reports */}
        {recent.length > 0 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">{recentLabel}</h2>
            <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
              {recent.map((entry, idx) => {
                const conf = reports.find((r) => r.key === entry.key) || { icon: 'fa-layer-group', softBg: 'bg-emerald-50', softText: 'text-emerald-600', labelKey: 'reports.full_label', labelSw: 'Ripoti Kamili' };
                const label = entry.label || (isSw ? conf.labelSw : t(conf.labelKey));
                const date = new Date(entry.date);
                return (
                  <div key={idx} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className={`w-9 h-9 rounded-lg ${conf.softBg} ${conf.softText} flex items-center justify-center text-sm flex-shrink-0`}>
                      <i className={`fas ${conf.icon}`}></i>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
                      <p className="text-xs text-gray-400">
                        {date.toLocaleDateString(isSw ? 'sw-TZ' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {entry.format.toUpperCase()}
                      </p>
                    </div>
                    <button
                      onClick={() => redownload(entry)}
                      aria-label={`Re-download ${label}`}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                    >
                      <i className="fas fa-download"></i>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Preview / detail modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" {...rowActivate(() => setPreview(null))}></div>
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <button onClick={() => setPreview(null)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
              <i className="fas fa-times"></i>
            </button>
            <div className={`w-14 h-14 rounded-2xl ${preview.softBg} ${preview.softText} flex items-center justify-center text-2xl mb-4`}>
              <i className={`fas ${preview.icon}`}></i>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{isSw ? preview.labelSw : t(preview.labelKey)}</h3>
            <p className="text-sm text-gray-500 mt-1">{metricPrimary(preview.key, metrics?.[preview.key], isSw)}</p>
            <p className="text-xs text-gray-400 mt-0.5">{metricSub(preview.key, metrics?.[preview.key], isSw)}</p>
            <p className="text-xs text-gray-400 mt-3">{rangeLabel}</p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { doDownload(preview.key, 'pdf', isSw ? preview.labelSw : t(preview.labelKey)); setPreview(null); }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors"
              >
                <i className="fas fa-file-pdf"></i> PDF
              </button>
              <button
                onClick={() => { doDownload(preview.key, 'csv', isSw ? preview.labelSw : t(preview.labelKey)); setPreview(null); }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                <i className="fas fa-file-csv"></i> {t('reports.excel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
