const content = {
  en: {
    kpis: [
      { label: 'Orders', value: '1,247', change: '+12%' },
      { label: 'Revenue', value: '4.2M', change: '+18%' },
      { label: 'Products', value: '89', change: '+3' },
    ],
    chartLabel: 'Revenue Trend',
    ordersLabel: 'Recent Orders',
    orders: [
      { name: 'Amina H.', item: 'Coca-Cola x5', amount: '7,500', status: 'Paid' },
      { name: 'Juma M.', item: 'Bread x3', amount: '4,500', status: 'Pending' },
      { name: 'Fatuma A.', item: 'Rice 5kg', amount: '12,000', status: 'Paid' },
    ],
    badge: '+12% Sales',
  },
  sw: {
    kpis: [
      { label: 'Maagizo', value: '1,247', change: '+12%' },
      { label: 'Mapato', value: '4.2M', change: '+18%' },
      { label: 'Bidhaa', value: '89', change: '+3' },
    ],
    chartLabel: 'Mwenendo wa Mapato',
    ordersLabel: 'Maagizo ya Hivi Karibuni',
    orders: [
      { name: 'Amina H.', item: 'Coca-Cola x5', amount: '7,500', status: 'Imelipwa' },
      { name: 'Juma M.', item: 'Mkate x3', amount: '4,500', status: 'Inasubiri' },
      { name: 'Fatuma A.', item: 'Mchele 5kg', amount: '12,000', status: 'Imelipwa' },
    ],
    badge: '+12% Mauzo',
  },
};

export default function HeroMockup({ lang = 'en' }) {
  const c = content[lang] || content.en;
  return (
    <div className="relative w-full max-w-lg mx-auto">
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-gradient-to-r from-emerald-500/20 to-indigo-500/20 rounded-3xl blur-2xl opacity-60" />

      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Browser chrome */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white dark:bg-gray-700 rounded-md px-3 py-1 text-[10px] text-gray-400 font-mono text-center">
              uzanite.shop/admin
            </div>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-4 space-y-3">
          {/* KPI Row */}
          <div className="grid grid-cols-3 gap-2">
              {c.kpis.map((kpi, i) => {
                const colors = ['bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400', 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'];
                return (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-2.5">
                <div className="text-[9px] text-gray-500 dark:text-gray-400 font-medium">{kpi.label}</div>
                <div className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">{kpi.value}</div>
                <div className={`text-[9px] font-semibold mt-0.5 ${colors[i].split(' ').pop()}`}>{kpi.change}</div>
              </div>
                );
              })}
          </div>

          {/* Mini chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-gray-700 dark:text-gray-300">{c.chartLabel}</span>
              <span className="text-[9px] text-emerald-600 font-medium">+18.2%</span>
            </div>
            <svg viewBox="0 0 200 50" className="w-full h-10">
              <defs>
                <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,40 Q20,35 40,30 T80,20 T120,25 T160,10 T200,5 V50 H0Z" fill="url(#chartGrad)" />
              <path d="M0,40 Q20,35 40,30 T80,20 T120,25 T160,10 T200,5" fill="none" stroke="#10b981" strokeWidth="2" />
              <circle cx="200" cy="5" r="3" fill="#10b981" />
            </svg>
          </div>

          {/* Recent orders */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-2">{c.ordersLabel}</div>
            {c.orders.map((o, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-t border-gray-200 dark:border-gray-700 first:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
                    <span className="text-[8px] font-bold text-indigo-600 dark:text-indigo-400">{o.name[0]}</span>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium text-gray-800 dark:text-gray-200">{o.name}</div>
                    <div className="text-[8px] text-gray-400">{o.item}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-semibold text-gray-800 dark:text-gray-200">{o.amount}</div>
                  <div className={`text-[8px] font-medium ${['Paid', 'Imelipwa'].includes(o.status) ? 'text-emerald-600' : 'text-amber-600'}`}>{o.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -top-3 -right-3 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg animate-bounce" style={{ animationDuration: '3s' }}>
        {c.badge}
      </div>
      <div className="absolute -bottom-2 -left-3 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        Live
      </div>
    </div>
  );
}
