import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../context/LangContext';

export default function UpdateBanner() {
  const [show, setShow] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [countdown, setCountdown] = useState(15);
  const { t } = useLang();

  const handleUpdate = useCallback(() => {
    if (registration) {
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  }, [registration]);

  useEffect(() => {
    const handler = (e) => {
      setRegistration(e.detail.registration);
      setShow(true);
      setCountdown(15);
    };
    window.addEventListener('sw-update', handler);
    return () => window.removeEventListener('sw-update', handler);
  }, []);

  // Auto-dismiss after 15s, then re-show on next check
  useEffect(() => {
    if (!show) return;
    if (countdown <= 0) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [show, countdown]);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] p-3 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto max-w-lg mx-auto bg-gray-900 text-white rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-gray-800">
          <div
            className="h-full bg-primary-500 transition-all duration-1000 ease-linear"
            style={{ width: `${(countdown / 15) * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-3 px-4 py-3 sm:px-5 sm:py-4">
          {/* Pulsing icon */}
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-xl bg-primary-600/20 flex items-center justify-center">
              <i className="fas fa-arrow-up text-primary-400 text-lg animate-bounce"></i>
            </div>
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-success-500 rounded-full border-2 border-gray-900 animate-pulse"></span>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">
              {t('update.new_version')}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('update.tap_to_update')}
            </p>
          </div>

          {/* Update button */}
          <button
            onClick={handleUpdate}
            className="flex-shrink-0 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-sm font-bold transition-colors active:scale-95"
          >
            <i className="fas fa-sync-alt mr-1.5"></i>
            {t('update.update')}
          </button>

          {/* Close */}
          <button
            onClick={() => setShow(false)}
            className="flex-shrink-0 text-gray-400 hover:text-white transition-colors p-1"
            aria-label={t('update.dismiss')}
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      </div>
    </div>
  );
}
