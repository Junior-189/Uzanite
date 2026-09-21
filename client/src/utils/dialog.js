/**
 * Promise-based in-app dialogs. Native `confirm`/`prompt` are suppressed in some
 * embedded webviews (Capacitor/Android), which silently drops destructive
 * confirmations. A <DialogHost/> registers a real handler; until then (and in
 * non-React contexts) we fall back to the browser dialog.
 */
let handler = null;

export function registerDialogHandler(next) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function confirmDialog(message, options = {}) {
  if (handler) return handler.confirm(message, options);
  return Promise.resolve(window.confirm(message));
}

export function promptDialog(message, options = {}) {
  if (handler) return handler.prompt(message, options);
  return Promise.resolve(window.prompt(message, options.defaultValue ?? ''));
}
