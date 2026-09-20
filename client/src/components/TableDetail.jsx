import { useState } from 'react';
import Modal from './Modal';

export function KebabMenu({ items, t, disabled = false }) {
  const [open, setOpen] = useState(false);
  const visible = items.filter((it) => !it.hide);
  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled || visible.length === 0}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 transition-colors"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={t ? t('common.actions') : 'Actions'}
      >
        <i className="fas fa-ellipsis-v"></i>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }}></div>
          <div className="absolute right-0 z-30 mt-2 w-48 max-w-[90vw] origin-top-right rounded-2xl bg-white shadow-xl ring-1 ring-black/5 py-1.5 animate-scale-in">
            {t && <div className="px-4 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{t('common.actions')}</div>}
            {visible.map((it, i) => (
              <button
                key={i}
                type="button"
                disabled={it.disabled}
                onClick={(e) => { e.stopPropagation(); setOpen(false); it.run(); }}
                className={`group w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 border-t border-gray-50 first:border-t-0 ${it.cls || 'text-gray-700 hover:bg-gray-50'}`}
              >
                <span className="w-5 flex items-center justify-center"><i className={`fas ${it.icon} text-[15px]`}></i></span>
                <span className="flex-1 text-left">{it.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DetailModal({ open, onClose, title, fields = [], footer, maxWidth = 'max-w-lg' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidth={maxWidth} footer={footer}>
      <div className="space-y-3">
        {fields.length === 0 && <p className="text-sm text-gray-400">{''}</p>}
        {fields.map((f, i) => (
          <div key={i} className="flex items-start justify-between gap-4 py-2 border-b border-gray-100 last:border-0">
            <span className="text-xs uppercase tracking-wide text-gray-400 flex-shrink-0">{f.label}</span>
            {f.receiptUrl ? (
              <a href={f.receiptUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-1.5">
                <img src={f.receiptUrl} alt={f.label} className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                <span><i className="fas fa-external-link-alt mr-1"></i>{f.value}</span>
              </a>
            ) : (
              <span className={`text-sm font-medium text-gray-900 text-right break-words ${f.mono ? 'font-mono' : ''}`}>{f.value || '—'}</span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
