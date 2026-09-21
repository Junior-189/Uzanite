/// <reference types="vite/client" />

// Capacitor injects a global object into the WebView. Typed as unknown here;
// callers narrow it (e.g. `window.Capacitor !== undefined`).
interface Window {
  Capacitor?: unknown;
}
