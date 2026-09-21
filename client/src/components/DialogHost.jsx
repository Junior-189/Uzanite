import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { registerDialogHandler } from '../utils/dialog';

/**
 * Renders promise-based confirm/prompt dialogs and registers the imperative
 * handler used by `confirmDialog`/`promptDialog`. Mounted once at the app root.
 */
export default function DialogHost() {
  const [state, setState] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const resolver = useRef(null);

  useEffect(() => {
    const unregister = registerDialogHandler({
      confirm: (message, options = {}) =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setState({ kind: 'confirm', message, ...options });
        }),
      prompt: (message, options = {}) =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setInputValue(options.defaultValue ?? '');
          setState({ kind: 'prompt', message, ...options });
        }),
    });
    return unregister;
  }, []);

  const finish = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  return (
    <Modal
      open={!!state}
      onClose={() => finish(state?.kind === 'prompt' ? null : false)}
      title={state?.title || (state?.kind === 'prompt' ? 'Input' : 'Please confirm')}
      footer={
        <>
          <button
            className="inline-flex items-center bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            onClick={() => finish(state?.kind === 'prompt' ? null : false)}
          >
            {state?.cancelText || 'Cancel'}
          </button>
          <button
            className={`inline-flex items-center px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors ${state?.danger ? 'bg-danger-600 hover:bg-danger-700' : 'bg-primary-600 hover:bg-primary-700'}`}
            onClick={() => finish(state?.kind === 'prompt' ? inputValue : true)}
          >
            {state?.confirmText || 'Confirm'}
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-600 whitespace-pre-wrap">{state?.message}</p>
      {state?.kind === 'prompt' && (
        <input
          autoFocus
          className="mt-3 w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') finish(inputValue); }}
        />
      )}
    </Modal>
  );
}
