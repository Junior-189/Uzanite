import { useLang } from '../context/LangContext';

const periodKeys = [
  { value: 'daily', labelKey: 'period.today' },
  { value: 'weekly', labelKey: 'period.week' },
  { value: 'monthly', labelKey: 'period.month' },
  { value: 'annually', labelKey: 'period.year' },
  { value: 'all', labelKey: 'period.all_time' },
];

export default function PeriodFilter({ value, onChange }) {
  const { t } = useLang();
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-gray-500">{t('period.label')}</span>
      <div className="flex gap-1.5">
        {periodKeys.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              value === p.value
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-primary-300 hover:text-primary-600'
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
