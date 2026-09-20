import { useLang } from '../context/LangContext';

// Shown when a tenant opens a page that the admin has disabled.
export default function FeatureDisabled({ featureKey, message }) {
  const { t } = useLang();
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <i className="fas fa-tools text-2xl text-gray-400"></i>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          {t('feature.disabled_title')}
        </h2>
        {message ? (
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{message}</p>
        ) : (
          <p className="text-sm text-gray-500">{t('feature.disabled_default')}</p>
        )}
      </div>
    </div>
  );
}
