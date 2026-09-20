import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import api from '../utils/api';
import db from '../db';
import StatCard from '../components/StatCard';
import PeriodFilter from '../components/PeriodFilter';
import StatusBadge from '../components/StatusBadge';

function formatCurrency(val) { return (val || 0).toLocaleString(); }
function formatCompact(val) {
  if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
  return String(val);
}

/* ── Trend Chart ──────────────────────────────────────────────────────────── */
function TrendChart({ data, color, label, formatValue, period, lang, t, type = 'area' }) {
  const [tooltip, setTooltip] = useState(null);
  const svgRef = useRef(null);
  const days = Object.keys(data || {}).sort();
  const values = days.map(d => data[d]);

  if (!days.length) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        <i className="fas fa-chart-area text-3xl opacity-30 block mb-2"></i>
        {t('dashboard.no_data')}
      </div>
    );
  }

  const max = Math.max(...values, 1);
  const w = 500, h = 200, padL = 45, padR = 15, padT = 20, padB = 30;
  const chartW = w - padL - padR, chartH = h - padT - padB;
  const xStep = days.length > 1 ? chartW / (days.length - 1) : chartW / 2;
  const getX = (i) => padL + (days.length > 1 ? i * xStep : chartW / 2);
  const getY = (v) => padT + chartH - (v / max) * chartH;
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const minVal = Math.min(...values);

  const formatLabel = (d) => {
    const locale = lang === 'sw' ? 'sw-TZ' : 'en-US';
    const dt = new Date(d.includes(' ') ? d : d + 'T12:00:00');
    if (period === 'daily') return d.split(' ')[1] || d;
    if (period === 'weekly') return dt.toLocaleDateString(locale, { weekday: 'short' });
    if (period === 'monthly') return dt.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    if (period === 'annually') return dt.toLocaleDateString(locale, { month: 'short' });
    return d.length > 7 ? d.substring(5) : d;
  };

  const gridSteps = [];
  for (let i = 0; i <= 5; i++) {
    const val = Math.round((max / 5) * i);
    gridSteps.push({ y: getY(val), label: formatValue ? formatValue(val) : formatCompact(val) });
  }

  const pts = days.map((_, i) => ({ x: getX(i), y: getY(values[i]) }));
  const smoothPath = pts.length > 2
    ? pts.reduce((acc, p, i, arr) => {
        if (i === 0) return `M${p.x},${p.y}`;
        const prev = arr[i - 1]; const cpx = (prev.x + p.x) / 2;
        return acc + ` C${cpx},${prev.y} ${cpx},${p.y} ${p.x},${p.y}`;
      }, '')
    : pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = smoothPath + ` L${pts[pts.length - 1].x},${padT + chartH} L${pts[0].x},${padT + chartH} Z`;

  const handleMouseMove = (e) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * w;
    let closest = 0, closestDist = Infinity;
    pts.forEach((p, i) => { const dist = Math.abs(p.x - mouseX); if (dist < closestDist) { closestDist = dist; closest = i; } });
    if (closestDist < xStep / 2) setTooltip({ x: pts[closest].x, y: pts[closest].y, value: values[closest], label: days[closest], index: closest });
    else setTooltip(null);
  };

  const avgY = getY(avg);
  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
        <defs>
          <linearGradient id={`ag-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridSteps.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={w - padR} y2={g.y} stroke="#f3f4f6" strokeWidth="1" />
            <text x={padL - 6} y={g.y + 3} textAnchor="end" fontSize="8" fill="#9ca3af" fontFamily="Inter,sans-serif">{g.label}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const show = days.length <= 8 || i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
          if (!show) return null;
          return <text key={d} x={getX(i)} y={h - 4} textAnchor="middle" fontSize="7.5" fill="#9ca3af" fontFamily="Inter,sans-serif">{formatLabel(d)}</text>;
        })}
        {type === 'area' && <path d={areaPath} fill={`url(#ag-${label})`} />}
        <path d={smoothPath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {avg > 0 && (
          <g>
            <line x1={padL} y1={avgY} x2={w - padR} y2={avgY} stroke={color} strokeWidth="0.8" strokeDasharray="4,3" opacity="0.4" />
            <text x={w - padR + 2} y={avgY + 3} fontSize="7" fill={color} opacity="0.6" fontFamily="Inter,sans-serif">{t('dashboard.avg')}</text>
          </g>
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={tooltip?.index === i ? 5 : (days.length <= 15 ? 3 : 0)} fill="#fff" stroke="#16a34a" strokeWidth="2" style={{ transition: 'r 0.15s ease' }} />
        ))}
        {tooltip && (
          <g>
            <line x1={tooltip.x} y1={padT} x2={tooltip.x} y2={padT + chartH} stroke="#16a34a" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
            <circle cx={tooltip.x} cy={tooltip.y} r="6" fill="#16a34a" opacity="0.15" />
            <circle cx={tooltip.x} cy={tooltip.y} r="4" fill="#fff" stroke="#16a34a" strokeWidth="2.5" />
            <rect x={tooltip.x - 38} y={tooltip.y - 28} width="76" height="20" rx="4" fill="#16a34a" opacity="0.95" />
            <text x={tooltip.x} y={tooltip.y - 15} textAnchor="middle" fontSize="8.5" fill="#fff" fontWeight="600" fontFamily="Inter,sans-serif">
              {formatValue ? formatValue(tooltip.value) : tooltip.value}
            </text>
          </g>
        )}
      </svg>
      <div className="flex justify-between text-xs text-gray-400 px-1 pt-1 border-t border-gray-100">
        <span>{t('dashboard.min')}: {formatValue ? formatValue(minVal) : minVal}</span>
        <span className="font-semibold" style={{ color }}>{t('dashboard.avg')}: {formatValue ? formatValue(avg) : avg}</span>
        <span>{t('dashboard.max')}: {formatValue ? formatValue(max) : max}</span>
      </div>
    </div>
  );
}

/* ── Donut Chart ──────────────────────────────────────────────────────────── */
function DonutChart({ segments, size = 160, thickness = 28, centerLabel, centerValue }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - thickness) / 2, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  let cumulative = 0;
  const arcs = segments.map((seg, i) => {
    const pct = seg.value / total; const dashLen = pct * circ; const dashOffset = -cumulative * circ; cumulative += pct;
    return { ...seg, pct, dashLen, dashOffset, idx: i };
  });
  return (
    <div className="flex items-center gap-5 flex-wrap justify-center">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="block" style={{ width: size, height: size, transform: 'rotate(-90deg)' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth={thickness} />
          {arcs.map((arc) => (
            <circle key={arc.idx} cx={cx} cy={cy} r={r} fill="none" stroke={arc.color}
              strokeWidth={hoverIdx === arc.idx ? thickness + 6 : thickness}
              strokeDasharray={`${arc.dashLen} ${circ - arc.dashLen}`} strokeDashoffset={arc.dashOffset}
              strokeLinecap="round" style={{ transition: 'stroke-width 0.2s ease', cursor: 'pointer' }}
              onMouseEnter={() => setHoverIdx(arc.idx)} onMouseLeave={() => setHoverIdx(null)} />
          ))}
        </svg>
        {centerLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-extrabold text-gray-900 leading-none">{centerValue ?? total}</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{centerLabel}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 min-w-[100px]">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 transition-opacity" style={{ opacity: hoverIdx !== null && hoverIdx !== i ? 0.4 : 1 }}>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: seg.color }}></span>
            <span className="text-xs text-gray-500 flex-1 truncate">{seg.label}</span>
            <span className="text-xs font-bold text-gray-900">{seg.value}</span>
            <span className="text-[10px] text-gray-400">({Math.round((seg.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_LABEL_KEYS = {
  PENDING: 'dashboard.pending',
  APPROVED: 'dashboard.approved',
  PENDING_PAYMENT: 'dashboard.payment',
  PAID: 'dashboard.paid',
  DELIVERED: 'dashboard.delivered',
  REJECTED: 'dashboard.rejected',
  CANCELLED: 'dashboard.rejected',
};

function StatusDonut({ breakdown, t }) {
  if (!breakdown || !Object.keys(breakdown).length) return null;
  const statusColors = { PENDING: '#f59e0b', APPROVED: '#3b82f6', PENDING_PAYMENT: '#f97316', PAID: '#22c55e', DELIVERED: '#06b6d4', REJECTED: '#ef4444', CANCELLED: '#6b7280' };
  const segments = Object.entries(breakdown).map(([status, count]) => ({
    label: STATUS_LABEL_KEYS[status] ? t(STATUS_LABEL_KEYS[status]) : status.replace(/_/g, ' '),
    value: count,
    color: statusColors[status] || '#94a3b8',
  }));
  return <DonutChart segments={segments} centerLabel={t('dashboard.orders')} centerValue={segments.reduce((s, g) => s + g.value, 0)} />;
}

function PaymentDonut({ stats, t }) {
  if (!stats) return null;
  const cash = stats.cashOrders || 0, online = stats.onlineOrders || 0;
  if (cash + online === 0) return <div className="text-center py-6 text-gray-400 text-sm">{t('dashboard.no_payment_data')}</div>;
  return <DonutChart segments={[{ label: t('dashboard.cash'), value: cash, color: '#22c55e' }, { label: t('dashboard.online'), value: online, color: '#3b82f6' }]} centerLabel={t('dashboard.payments')} centerValue={cash + online} />;
}

function HorizontalBarChart({ items, colorFn, t }) {
  const [hover, setHover] = useState(null);
  if (!items || !items.length) return <div className="text-center py-6 text-gray-400 text-sm">{t('dashboard.no_data')}</div>;
  const maxVal = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, i) => {
        const bg = colorFn ? colorFn(i) : `hsl(${210 + i * 30}, 70%, 55%)`;
        const isHover = hover === i;
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 rounded-md px-1 -mx-1 transition-colors"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="w-28 text-xs text-gray-500 text-right truncate flex-shrink-0" title={item.label}>{item.label}</span>
            <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{ width: `${Math.max((item.value / maxVal) * 100, 3)}%`, background: bg }}
              >
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white drop-shadow-sm">{item.value}</span>
              </div>
              <div
                className="absolute left-0 top-0 h-full rounded-md bg-[#16a34a] transition-opacity duration-200 pointer-events-none"
                style={{ width: `${Math.max((item.value / maxVal) * 100, 3)}%`, opacity: isHover ? 1 : 0 }}
              ></div>
              {isHover && (
                <div className="absolute -top-8 right-0 bg-gray-900 text-white text-[11px] rounded-lg px-2 py-1 shadow-lg z-10 whitespace-nowrap pointer-events-none">
                  {item.label}: <span className="font-semibold">{item.value}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FunnelChart({ stats, t }) {
  const [hover, setHover] = useState(null);
  if (!stats) return null;
  const steps = [
    { label: t('dashboard.pending'), value: stats.pendingOrders || 0, color: '#f59e0b', bg: '#fef3c7' },
    { label: t('dashboard.approved'), value: stats.approvedOrders || 0, color: '#3b82f6', bg: '#dbeafe' },
    { label: t('dashboard.payment'), value: stats.pendingPaymentOrders || 0, color: '#f97316', bg: '#ffedd5' },
    { label: t('dashboard.paid'), value: Math.max(0, (stats.paidOrders || 0) - (stats.deliveredOrders || 0)), color: '#22c55e', bg: '#dcfce7' },
    { label: t('dashboard.delivered'), value: stats.deliveredOrders || 0, color: '#06b6d4', bg: '#cffafe' },
    { label: t('dashboard.rejected'), value: stats.rejectedOrders || 0, color: '#ef4444', bg: '#fee2e2' },
  ];
  const maxVal = Math.max(...steps.map(s => s.value), 1);
  return (
    <div className="flex flex-col items-center gap-1">
      {steps.map((step, i) => {
        const isHover = hover === i;
        return (
          <div
            key={i}
            className="relative flex items-center justify-center h-8 rounded-md transition-all duration-500 cursor-default overflow-hidden"
            style={{ width: Math.max((step.value / maxVal) * 360, 60), background: step.bg }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="absolute inset-0 bg-[#16a34a] transition-opacity duration-200 pointer-events-none"
              style={{ opacity: isHover ? 0.85 : 0 }}
            ></div>
            <span className="text-xs font-bold" style={{ color: step.color }}>{step.label}</span>
            <span className="text-xs font-semibold ml-1.5 opacity-70" style={{ color: step.color }}>{step.value}</span>
            {isHover && (
              <div className="absolute -top-8 bg-gray-900 text-white text-[11px] rounded-lg px-2 py-1 shadow-lg z-10 whitespace-nowrap pointer-events-none">
                {step.label}: <span className="font-semibold">{step.value}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('alltime');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashData, setDashData] = useState(null);

  useEffect(() => { fetchStats(); }, [period]);

  useEffect(() => {
    const isAdmin = user?.role === 'super_admin' || user?.role === 'sub_admin';
    if (isAdmin && !user?.impersonating) {
      navigate('/admin/adminPanel', { replace: true });
    }
  }, [user, navigate]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const cached = await db.dashboardCache.get(`stats-${period}`);
      if (cached?.data) {
        setStats(cached.data.stats);
        setDashData(cached.data);
        setLoading(false);
      }
    } catch {}

    try {
      const res = await api.get(`/dashboard/stats?period=${period}`);
      if (res.success) {
        setStats(res.stats);
        setDashData(res);
        await db.dashboardCache.put({ key: `stats-${period}`, data: res });
      }
    } catch {
      if (!stats) showToast(t('dashboard.failed_to_load'), 'error');
    }
    setLoading(false);
  };

  const revenue = stats?.revenue || 0;
  const expenses = stats?.totalExpenses || 0;
  const profit = stats?.totalProfit || revenue - expenses;
  const totalOrders = stats?.totalOrders || 0;
  const topProductsItems = useMemo(() => (dashData?.topProducts || []).map(p => ({ label: p.name, value: p.count })), [dashData?.topProducts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i className="fas fa-chart-line text-primary-600"></i> {t('dashboard.stats_sales')}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('dashboard.label_dashboard')}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate('/admin/orders')} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 shadow-sm transition-colors">
            <i className="fas fa-clipboard-list mr-1.5"></i> {t('dashboard.btn_orders')}
          </button>
          <button onClick={() => navigate('/admin/products')} className="px-4 py-2 rounded-xl bg-white text-gray-700 border border-gray-300 text-sm font-medium hover:bg-gray-50 transition-colors">
            <i className="fas fa-tag mr-1.5"></i> {t('dashboard.btn_products')}
          </button>
        </div>
      </div>

      {/* Period Filter */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-3 border-gray-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        </div>
        ) : stats ? (
        <>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon="fa-shopping-bag" color="blue" value={totalOrders} label={t('dashboard.stats_orders')} onClick={() => navigate('/admin/orders')} />
            <StatCard icon="fa-money-bill-wave" color="green" value={formatCurrency(revenue)} label={t('dashboard.stats_sales')} />
            <StatCard icon="fa-receipt" color="orange" value={formatCurrency(expenses)} label={t('dashboard.stats_expenses')} onClick={() => navigate('/admin/expenses')} />
            <StatCard icon="fa-chart-line" color="purple" value={formatCurrency(profit)} label={t('dashboard.stats_profit')} />
          </div>

          {/* Row 1: Payment Split + Top Products */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-credit-card text-gray-400"></i> {t('dashboard.payment_split')}</h3>
              <PaymentDonut stats={stats} t={t} />
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-star text-gray-400"></i> {t('dashboard.top_products')}</h3>
              <HorizontalBarChart items={topProductsItems} colorFn={(i) => ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]} t={t} />
            </div>
          </div>

          {/* Row 2: Status Breakdown + Revenue Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-chart-pie text-gray-400"></i> {t('dashboard.status_breakdown')}</h3>
              <StatusDonut breakdown={dashData?.statusBreakdown} t={t} />
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-chart-line text-success-500"></i> {t('dashboard.revenue_trend')}</h3>
              <TrendChart data={dashData?.revenueByDay} color="#22c55e" label="revenue" formatValue={formatCurrency} period={period} lang={lang} t={t} />
            </div>
          </div>

          {/* Row 3: Profit Trend + Order Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-chart-line text-warning-500"></i> {t('dashboard.profit_trend')}</h3>
              <TrendChart data={dashData?.profitByDay} color="#f59e0b" label="profit" formatValue={formatCurrency} period={period} lang={lang} t={t} />
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-chart-bar text-primary-500"></i> {t('dashboard.order_trend')}</h3>
              <TrendChart data={dashData?.ordersByDay} color="#3b82f6" label="orders" period={period} lang={lang} t={t} type="area" />
            </div>
          </div>

          {/* Row 4: Expenses Trend + Order Funnel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-chart-line text-danger-500"></i> {t('dashboard.expenses_trend')}</h3>
              <TrendChart data={dashData?.expensesByDay} color="#ef4444" label="expenses" formatValue={formatCurrency} period={period} lang={lang} t={t} />
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><i className="fas fa-filter text-gray-400"></i> {t('dashboard.order_funnel')}</h3>
              <FunnelChart stats={stats} t={t} />
            </div>
          </div>

          {/* Low Stock Alert */}
          {dashData?.lowStockCount > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-danger-500">
              <div className="px-5 py-4 flex items-center justify-between bg-danger-50 rounded-t-xl">
                <h3 className="text-sm font-semibold text-danger-700 flex items-center gap-2"><i className="fas fa-exclamation-triangle"></i> {t('dashboard.low_stock_alert')}</h3>
                <span className="text-xs font-bold bg-danger-500 text-white px-2.5 py-0.5 rounded-full">{dashData.lowStockCount} {t('dashboard.items')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100"><th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.product')}</th><th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.stock')}</th><th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.threshold')}</th></tr></thead>
                  <tbody>
                    {(dashData.lowStockProducts || []).map((p) => (
                      <tr key={p._id} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-2.5 text-gray-900">{p.name}</td>
                        <td className="px-5 py-2.5"><StatusBadge status={p.stock === 0 ? 'rejected' : 'pending'}>{p.stock}</StatusBadge></td>
                        <td className="px-5 py-2.5 text-gray-500">{p.threshold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent Orders */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><i className="fas fa-clipboard-list text-gray-400"></i> {t('dashboard.recent_orders')}</h3>
              <button onClick={() => navigate('/admin/orders')} className="text-xs font-semibold text-primary-600 hover:text-primary-700">{t('dashboard.view_all')} &rarr;</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.order_num')}</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.customer')}</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.status')}</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.total')}</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-500 uppercase">{t('dashboard.date')}</th>
                </tr></thead>
                <tbody>
                  {(dashData?.recentOrders || []).length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">{t('dashboard.no_orders_yet')}</td></tr>
                  ) : (dashData?.recentOrders || []).map((order) => (
                    <tr key={order._id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-2.5 font-semibold text-gray-900">{order.orderNumber}</td>
                      <td className="px-5 py-2.5 text-gray-600">{order.customer || order.customerName || '—'}</td>
                      <td className="px-5 py-2.5"><StatusBadge status={order.status?.toLowerCase()}>{order.status}</StatusBadge></td>
                      <td className="px-5 py-2.5 text-gray-900 font-medium">{formatCurrency(order.total)}</td>
                      <td className="px-5 py-2.5 text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4"><i className="fas fa-chart-line text-2xl text-gray-400"></i></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{t('dashboard.no_data_available')}</h3>
          <p className="text-sm text-gray-500">{t('dashboard.no_data_hint')}</p>
        </div>
      )}
    </div>
  );
}
