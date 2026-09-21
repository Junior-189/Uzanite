import { useEffect, useId, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children, footer, maxWidth = 'max-w-md' }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      // Move focus into the dialog for keyboard/screen-reader users.
      if (dialogRef.current) dialogRef.current.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Escape to close + Tab focus trap so focus cannot leave the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose && onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // The wrapper is layout only (role="presentation"), so assistive tech does
    // not announce it as interactive. Dismissal is offered two ways that both
    // work without a mouse: Escape (handled above) and the labelled close
    // button. The backdrop keeps click-to-dismiss as a sighted convenience.
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 w-full h-full bg-black/50 backdrop-blur-sm animate-fade-in cursor-default"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full ${maxWidth} animate-scale-in max-h-[85vh] sm:max-h-[70vh] overflow-y-auto focus:outline-none pb-[env(safe-area-inset-bottom)]`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 pt-6 pb-0">
            <h3 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        )}
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-6 pb-6 pt-2 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
