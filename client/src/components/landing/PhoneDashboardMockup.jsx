const sidebarNavEn = [
  { icon: 'fas fa-chart-line', label: 'Dashboard' },
  { icon: 'fas fa-clipboard-list', label: 'Orders', badge: true },
  { icon: 'fas fa-tag', label: 'Products' },
  { icon: 'fas fa-receipt', label: 'Expenses' },
  { icon: 'fas fa-shopping-cart', label: 'Purchases' },
  { icon: 'fas fa-hand-holding-usd', label: 'Debts' },
  { icon: 'fas fa-users', label: 'Staff' },
  { icon: 'fas fa-comments', label: 'WhatsApp' },
  { icon: 'fas fa-cog', label: 'Settings' },
];
const sidebarNavSw = [
  { icon: 'fas fa-chart-line', label: 'Dashibodi' },
  { icon: 'fas fa-clipboard-list', label: 'Maagizo', badge: true },
  { icon: 'fas fa-tag', label: 'Bidhaa' },
  { icon: 'fas fa-receipt', label: 'Gharama' },
  { icon: 'fas fa-shopping-cart', label: 'Manunuzi' },
  { icon: 'fas fa-hand-holding-usd', label: 'Madeni' },
  { icon: 'fas fa-users', label: 'Wafanyakazi' },
  { icon: 'fas fa-comments', label: 'WhatsApp' },
  { icon: 'fas fa-cog', label: 'Mipangilio' },
];
const content = {
  en: {
    title: 'Dashboard',
    sidebarNav: sidebarNavEn,
    rows: [
      {
        type: 'kpi-2',
        items: [
          { label: 'Total Orders', value: '1,247', change: '+12%', color: 'blue' },
          { label: 'Total Sales', value: '4,250,000', prefix: 'TSh', change: '+18%', color: 'emerald' },
        ],
      },
      {
        type: 'kpi-2',
        items: [
          { label: 'Total Expenses', value: '1,850,000', prefix: 'TSh', change: '+8%', color: 'amber' },
          { label: 'Total Profit', value: '2,400,000', prefix: 'TSh', change: '+22%', color: 'purple' },
        ],
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Payment Split',
          segments: [
            { label: 'Cash', value: 65, color: '#10b981' },
            { label: 'Online', value: 35, color: '#6366f1' },
          ],
        },
        right: {
          type: 'hbar',
          label: 'Top 5 Products',
          bars: [
            { label: 'Coca-Cola', value: 85 },
            { label: 'Bread', value: 72 },
            { label: 'Rice', value: 60 },
            { label: 'Sugar', value: 45 },
            { label: 'Soap', value: 30 },
          ],
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Order Status',
          segments: [
            { label: 'Pending', value: 20, color: '#f59e0b' },
            { label: 'Paid', value: 55, color: '#10b981' },
            { label: 'Cancelled', value: 25, color: '#ef4444' },
          ],
        },
        right: {
          type: 'line',
          label: 'Revenue Trend',
          points: [20, 35, 25, 50, 40, 65, 55, 75, 60, 85, 70, 90],
          color: '#10b981',
          change: '+18.2%',
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'line',
          label: 'Profit Trend',
          points: [30, 25, 45, 35, 55, 45, 65, 55, 75, 65, 85, 70],
          color: '#8b5cf6',
          change: '+22%',
        },
        right: {
          type: 'line',
          label: 'Order Trend',
          points: [15, 30, 20, 40, 30, 50, 40, 60, 50, 70, 60, 80],
          color: '#3b82f6',
          change: '+15%',
        },
      },
    ],
  },
  sw: {
    title: 'Dashibodi',
    rows: [
      {
        type: 'kpi-2',
        items: [
          { label: 'Jumla ya Maagizo', value: '1,247', change: '+12%', color: 'blue' },
          { label: 'Jumla ya Mauzo', value: '4,250,000', prefix: 'TSh', change: '+18%', color: 'emerald' },
        ],
      },
      {
        type: 'kpi-2',
        items: [
          { label: 'Jumla ya Matumizi', value: '1,850,000', prefix: 'TSh', change: '+8%', color: 'amber' },
          { label: 'Faida Jumla', value: '2,400,000', prefix: 'TSh', change: '+22%', color: 'purple' },
        ],
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Mgawanyo wa Malipo',
          segments: [
            { label: 'Cash', value: 65, color: '#10b981' },
            { label: 'Online', value: 35, color: '#6366f1' },
          ],
        },
        right: {
          type: 'hbar',
          label: 'Bidhaa 5 Bora',
          bars: [
            { label: 'Coca-Cola', value: 85 },
            { label: 'Mkate', value: 72 },
            { label: 'Mchele', value: 60 },
            { label: 'Sukari', value: 45 },
            { label: 'Sabuni', value: 30 },
          ],
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Hali ya Maagizo',
          segments: [
            { label: 'Inasubiri', value: 20, color: '#f59e0b' },
            { label: 'Imelipwa', value: 55, color: '#10b981' },
            { label: 'Imefutwa', value: 25, color: '#ef4444' },
          ],
        },
        right: {
          type: 'line',
          label: 'Mwenendo wa Mapato',
          points: [20, 35, 25, 50, 40, 65, 55, 75, 60, 85, 70, 90],
          color: '#10b981',
          change: '+18.2%',
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'line',
          label: 'Mwenendo wa Faida',
          points: [30, 25, 45, 35, 55, 45, 65, 55, 75, 65, 85, 70],
          color: '#8b5cf6',
          change: '+22%',
        },
        right: {
          type: 'line',
          label: 'Mwenendo wa Maagizo',
          points: [15, 30, 20, 40, 30, 50, 40, 60, 50, 70, 60, 80],
          color: '#3b82f6',
          change: '+15%',
        },
      },
    ],
    sidebarNav: [
      { icon: 'fas fa-chart-line', label: 'Dashboard' },
      { icon: 'fas fa-clipboard-list', label: 'Orders', badge: true },
      { icon: 'fas fa-tag', label: 'Products' },
      { icon: 'fas fa-address-book', label: 'Contacts', badge: true },
      { icon: 'fas fa-comments', label: 'WhatsApp' },
      { icon: 'fas fa-bullhorn', label: 'Broadcast' },
      { icon: 'fas fa-receipt', label: 'Expenses' },
      { icon: 'fas fa-shopping-cart', label: 'Purchases' },
      { icon: 'fas fa-hand-holding-usd', label: 'Debts' },
      { icon: 'fas fa-users', label: 'Staff' },
      { icon: 'fas fa-store', label: 'Business' },
      { icon: 'fas fa-cog', label: 'Settings' },
      { icon: 'fas fa-bell', label: 'Notifications', badge: true },
      { icon: 'fas fa-trash-restore', label: 'Recycle Bin' },
    ],
  },
  sw: {
    title: 'Dashibodi',
    sidebarNav: sidebarNavSw,
    rows: [
      {
        type: 'kpi-2',
        items: [
          { label: 'Jumla ya Maagizo', value: '1,247', change: '+12%', color: 'blue' },
          { label: 'Jumla ya Mauzo', value: '4,250,000', prefix: 'TSh', change: '+18%', color: 'emerald' },
        ],
      },
      {
        type: 'kpi-2',
        items: [
          { label: 'Jumla ya Matumizi', value: '1,850,000', prefix: 'TSh', change: '+8%', color: 'amber' },
          { label: 'Faida Jumla', value: '2,400,000', prefix: 'TSh', change: '+22%', color: 'purple' },
        ],
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Mgawanyo wa Malipo',
          segments: [
            { label: 'Cash', value: 65, color: '#10b981' },
            { label: 'Online', value: 35, color: '#6366f1' },
          ],
        },
        right: {
          type: 'hbar',
          label: 'Bidhaa 5 Bora',
          bars: [
            { label: 'Coca-Cola', value: 85 },
            { label: 'Mkate', value: 72 },
            { label: 'Mchele', value: 60 },
            { label: 'Sukari', value: 45 },
            { label: 'Sabuni', value: 30 },
          ],
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'donut',
          label: 'Hali ya Maagizo',
          segments: [
            { label: 'Inasubiri', value: 20, color: '#f59e0b' },
            { label: 'Imelipwa', value: 55, color: '#10b981' },
            { label: 'Imefutwa', value: 25, color: '#ef4444' },
          ],
        },
        right: {
          type: 'line',
          label: 'Mwenendo wa Mapato',
          points: [20, 35, 25, 50, 40, 65, 55, 75, 60, 85, 70, 90],
          color: '#10b981',
          change: '+18.2%',
        },
      },
      {
        type: 'charts-2',
        left: {
          type: 'line',
          label: 'Mwenendo wa Faida',
          points: [30, 25, 45, 35, 55, 45, 65, 55, 75, 65, 85, 70],
          color: '#8b5cf6',
          change: '+22%',
        },
        right: {
          type: 'line',
          label: 'Mwenendo wa Maagizo',
          points: [15, 30, 20, 40, 30, 50, 40, 60, 50, 70, 60, 80],
          color: '#3b82f6',
          change: '+15%',
        },
      },
    ],
  },
};

const colorMap = {
  blue: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-900/30', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800' },
};

function DonutChart({ segments, label, lang }) {
  const total = segments.reduce((s, s2) => s + s2.value, 0);
  const cx = 60, cy = 60, r = 40;
  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const angle = pct * 360;
    const startAngle = (offset - 90) * Math.PI / 180;
    offset += angle;
    return { ...seg, pct, startAngle, angle };
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 shadow-sm">
      <div className="text-[8px] font-semibold text-gray-700 dark:text-gray-300 mb-1 text-center">{label}</div>
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 120 120" className="w-16 h-16 flex-shrink-0">
          {arcs.map((seg, i) => {
            const endAngle = seg.startAngle + seg.angle * Math.PI / 180;
            const x1 = cx + r * Math.cos(seg.startAngle);
            const y1 = cy + r * Math.sin(seg.startAngle);
            const x2 = cx + r * Math.cos(endAngle);
            const y2 = cy + r * Math.sin(endAngle);
            const large = seg.angle > 180 ? 1 : 0;
            return (
              <path key={i} d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`} fill={seg.color} />
            );
          })}
          <circle cx={cx} cy={cy} r={r * 0.55} fill="white" className="dark:fill-gray-800" />
        </svg>
        <div className="space-y-1 flex-1 min-w-0">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[7px]">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
              <span className="text-gray-600 dark:text-gray-400 truncate">{seg.label}</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200 ml-auto">{seg.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HBarChart({ bars, label }) {
  const max = Math.max(...bars.map((b) => b.value));
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 shadow-sm">
      <div className="text-[8px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5 text-center">{label}</div>
      <div className="space-y-1">
        {bars.map((bar, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[7px]">
            <span className="text-gray-600 dark:text-gray-400 w-10 truncate text-right">{bar.label}</span>
            <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
                style={{ width: `${(bar.value / max) * 100}%` }}
              />
            </div>
            <span className="font-semibold text-gray-800 dark:text-gray-200 w-6 text-right">{bar.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ points, color, label, change }) {
  const w = 150, h = 50;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const pathD = points.map((p, i) => {
    const x = i * stepX;
    const y = h - ((p - min) / range) * (h * 0.8) - h * 0.1;
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');
  const areaD = pathD + ` L${w},${h} L0,${h} Z`;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-semibold text-gray-700 dark:text-gray-300">{label}</span>
        {change && <span className="text-[7px] font-medium text-emerald-600">{change}</span>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
        <defs>
          <linearGradient id={`grad-${label.replace(/\s/g, '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#grad-${label.replace(/\s/g, '')})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" />
        <circle cx={w - stepX} cy={h - ((points[points.length - 1] - min) / range) * (h * 0.8) - h * 0.1} r="2" fill={color} />
      </svg>
    </div>
  );
}

const ScrollKeyframes = () => (
  <style>{`
    @keyframes dashScroll {
      0% { transform: translateY(0); }
      8% { transform: translateY(0); }
      10% { transform: translateY(-72px); }
      18% { transform: translateY(-72px); }
      20% { transform: translateY(-144px); }
      28% { transform: translateY(-144px); }
      30% { transform: translateY(-290px); }
      38% { transform: translateY(-290px); }
      40% { transform: translateY(-436px); }
      48% { transform: translateY(-436px); }
      50% { transform: translateY(0); }
      80% { transform: translateY(0); }
      82% { transform: translateY(0); }
      100% { transform: translateY(0); }
    }
    @keyframes sidebarSlide {
      0%, 48% { transform: translateX(-100%); }
      50% { transform: translateX(0); }
      78% { transform: translateX(0); }
      80% { transform: translateX(-100%); }
      100% { transform: translateX(-100%); }
    }
    .dash-scroll { animation: dashScroll 20s ease-in-out infinite; }
    .sidebar-overlay { animation: sidebarSlide 20s ease-in-out infinite; }
  `}</style>
);

export default function PhoneDashboardMockup({ lang = 'en' }) {
  const data = content[lang] || content.en;

  return (
    <>
      <ScrollKeyframes />
      <div className="relative mx-auto w-[200px] sm:w-[240px]">
        {/* Glow */}
        <div className="absolute -inset-4 bg-gradient-to-b from-emerald-500/15 to-indigo-500/15 rounded-[2.5rem] blur-xl" />

        {/* Tablet-like frame */}
        <div className="relative bg-gray-900 dark:bg-gray-950 rounded-[1.5rem] p-2 shadow-2xl">
          {/* Screen */}
          <div className="relative bg-gray-50 dark:bg-gray-900 rounded-[1.25rem] overflow-hidden flex flex-col h-[420px] border border-gray-800/50">
            {/* Status bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 z-10">
              <div className="flex items-center gap-1 text-[8px] text-gray-500 dark:text-gray-400">
                <span>9:41</span>
              </div>
              <div className="text-[10px] font-bold text-gray-800 dark:text-gray-200">{data.title}</div>
              <div className="flex items-center gap-1 text-[8px] text-gray-500 dark:text-gray-400">
                <span>🔋</span>
              </div>
            </div>

            {/* Scrolling dashboard content */}
            <div className="flex-1 overflow-hidden">
              <div className="dash-scroll space-y-0">
                {data.rows.map((row, idx) => {
                  if (row.type === 'kpi-2') {
                    return (
                      <div key={idx} className="px-2.5 py-2">
                        <div className="grid grid-cols-2 gap-2">
                          {row.items.map((item, i) => {
                            const c = colorMap[item.color] || colorMap.blue;
                            return (
                              <div key={i} className={`${c.bg} ${c.border} rounded-lg p-2 border`}>
                                <div className={`text-[7px] font-semibold ${c.text} mb-0.5`}>{item.label}</div>
                                <div className="text-xs font-bold text-gray-900 dark:text-white">
                                  {item.prefix && <span className="text-[7px] font-medium text-gray-500 dark:text-gray-400 mr-0.5">{item.prefix}</span>}
                                  {item.value}
                                </div>
                                <div className={`text-[7px] font-medium ${c.text} mt-0.5`}>{item.change}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (row.type === 'charts-2') {
                    return (
                      <div key={idx} className="px-2.5 py-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            {row.left.type === 'donut' && (
                              <DonutChart segments={row.left.segments} label={row.left.label} lang={lang} />
                            )}
                            {row.left.type === 'line' && (
                              <LineChart points={row.left.points} color={row.left.color} label={row.left.label} change={row.left.change} />
                            )}
                          </div>
                          <div>
                            {row.right.type === 'hbar' && <HBarChart bars={row.right.bars} label={row.right.label} />}
                            {row.right.type === 'line' && (
                              <LineChart points={row.right.points} color={row.right.color} label={row.right.label} change={row.right.change} />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>

            {/* Sidebar overlay - slides in from the left */}
            <div className="sidebar-overlay absolute inset-0 z-20">
              <div className="w-1/3 h-full bg-gradient-to-b from-slate-900 to-slate-800 text-slate-300 flex flex-col shadow-2xl">
                <div className="p-2 border-b border-white/10">
                  <div className="flex items-center gap-2 mb-1">
                    <svg width="22" height="22" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#10b981"/><text x="24" y="31" fontFamily="Inter,Arial,sans-serif" fontSize="8" fontWeight="800" fill="white" textAnchor="middle">UZANITE</text></svg>
                    <div>
                      <h2 className="text-white font-semibold text-[6px] leading-tight">UZANITE</h2>
                      <small className="text-slate-400 text-[5px]">UZANITE</small>
                    </div>
                  </div>
                </div>
                <nav className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5">
                  {data.sidebarNav.map((item, i) => (
                    <div
                      key={i}
                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded-lg text-[6px] font-medium ${
                        i === 0
                          ? 'bg-emerald-600/20 text-white border-l-[2px] border-emerald-400'
                          : 'text-slate-400 border-l-[2px] border-transparent'
                      }`}
                    >
                      <i className={`${item.icon} w-3 text-center text-[6px] ${i === 0 ? 'text-emerald-400' : ''}`}></i>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {item.badge && (
                        <span className="bg-red-500 text-white text-[4px] font-bold px-1 py-0.5 rounded-full min-w-[12px] text-center">3</span>
                      )}
                    </div>
                  ))}
                </nav>
                <div className="p-1.5 border-t border-white/10">
                  <div className="flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg bg-white/5 text-slate-400 text-[6px]">
                    <i className="fas fa-sign-out-alt"></i> {lang === 'sw' ? 'Toka' : 'Logout'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}