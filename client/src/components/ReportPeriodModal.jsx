import Modal from './Modal';
import { useLang } from '../context/LangContext';
import { getAccessToken } from '../utils/tokenStore';

const periods = [
  { value: 'daily', labelKey: 'period.today', icon: 'fa-calendar-day' },
  { value: 'weekly', labelKey: 'period.week', icon: 'fa-calendar-week' },
  { value: 'monthly', labelKey: 'period.month', icon: 'fa-calendar' },
  { value: 'annually', labelKey: 'period.year', icon: 'fa-calendar-alt' },
  { value: 'alltime', labelKey: 'period.all_time', icon: 'fa-infinity' },
];

export default function ReportPeriodModal({ open, onClose, onSelect, title }) {
  const { t } = useLang();
  return (
    <Modal open={open} onClose={onClose} title={null} maxWidth="max-w-sm">
      <div className="text-center mb-5">
        <div className="w-12 h-12 rounded-xl bg-primary-50 flex items-center justify-center mx-auto mb-3">
          <i className="fas fa-calendar-check text-primary-600 text-lg"></i>
        </div>
        <h3 className="text-lg font-bold text-gray-900">{title || t('report_period.title')}</h3>
      </div>
      <div className="flex flex-col gap-2">
        {periods.map((p) => (
          <button
            key={p.value}
            onClick={() => { onSelect(p.value); onClose(); }}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-sm font-medium text-gray-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-all duration-150"
          >
            <i className={`fas ${p.icon} w-5 text-center text-primary-500`}></i>
            {t(p.labelKey)}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function downloadReport(endpoint, filename, period = 'alltime') {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `/api/reports/${endpoint}?period=${period}`, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + (getAccessToken() || ''));
  xhr.responseType = 'blob';
  xhr.onload = function () {
    if (xhr.status === 200) {
      const blob = new Blob([xhr.response], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
    }
  };
  xhr.send();
}
