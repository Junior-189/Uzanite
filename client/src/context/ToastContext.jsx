import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const borderColor = { success: 'border-l-success-500', error: 'border-l-danger-500', warning: 'border-l-warning-500', info: 'border-l-primary-500' };
  const iconMap = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[2000] flex flex-col gap-2.5 max-w-sm w-[calc(100%-2rem)]">
        {toasts.map((t) => (
          <div key={t.id} role="alert" className={`bg-white rounded-xl shadow-lg border border-gray-100 border-l-4 ${borderColor[t.type] || borderColor.info} p-3.5 flex items-start gap-2.5 cursor-pointer animate-slide-in-right`} onClick={() => removeToast(t.id)}>
            <span className="text-base flex-shrink-0 mt-0.5">{iconMap[t.type] || iconMap.info}</span>
            <div className="flex-1 min-w-0"><span className="text-sm text-gray-800 leading-snug">{t.message}</span></div>
            <button className="text-gray-300 hover:text-gray-500 flex-shrink-0 text-lg leading-none transition-colors" onClick={() => removeToast(t.id)}>&times;</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
