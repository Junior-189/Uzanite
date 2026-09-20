const colorMap = {
  blue: { bg: 'bg-primary-50', icon: 'text-primary-600' },
  green: { bg: 'bg-success-50', icon: 'text-success-600' },
  yellow: { bg: 'bg-warning-50', icon: 'text-warning-600' },
  red: { bg: 'bg-danger-50', icon: 'text-danger-600' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
  orange: { bg: 'bg-orange-50', icon: 'text-orange-600' },
  cyan: { bg: 'bg-info-50', icon: 'text-info-600' },
  pink: { bg: 'bg-pink-50', icon: 'text-pink-600' },
};

function abbreviateNumber(num) {
  if (typeof num === 'string') return num;
  const n = Number(num);
  if (isNaN(n)) return num;
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

export default function StatCard({ icon, color = 'blue', value, label, title, subtitle, onClick, active }) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div
      className={`bg-white rounded-xl p-4 sm:p-5 shadow-sm border flex items-center gap-3 sm:gap-4 transition-all duration-200 ${active ? 'border-primary-500 ring-2 ring-primary-200' : 'border-gray-100'} ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'hover:shadow-md'}`}
      onClick={onClick}
    >
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0`}>
        <i className={`fas ${icon} text-base sm:text-lg ${c.icon}`}></i>
      </div>
      <div className="min-w-0 flex-1">
        {title ? (
          <>
            <div className="text-sm font-bold text-gray-900 leading-tight truncate">{title}</div>
            <div className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">{subtitle}</div>
          </>
        ) : (
          <>
            <div className="text-lg sm:text-2xl font-bold text-gray-900 leading-tight truncate">{abbreviateNumber(value)}</div>
            <div className="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">{label}</div>
          </>
        )}
      </div>
    </div>
  );
}
