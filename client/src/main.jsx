import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { startSyncListener } from './db/sync'

startSyncListener();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = import.meta.env.BASE_URL + 'sw.js';
    navigator.serviceWorker.register(swPath).then((reg) => {
      const checkForUpdate = () => reg.update().catch(() => {});

      // Check for updates every 60 seconds
      setInterval(checkForUpdate, 60_000);

      // Check when page regains visibility (user returns to tab)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Auto-activate new SW immediately
              newWorker.postMessage({ type: 'SKIP_WAITING' });
              window.dispatchEvent(new CustomEvent('sw-update', { detail: { registration: reg } }));
            }
          });
        }
      });
    }).catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
