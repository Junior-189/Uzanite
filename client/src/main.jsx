import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import { startSyncListener } from './db/sync'

startSyncListener();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swPath = import.meta.env.BASE_URL + 'sw.js';
    navigator.serviceWorker.register(swPath).then((reg) => {
      const checkForUpdate = () => reg.update().catch(() => {});

      // Check for a new build occasionally rather than every minute: a 60s poll
      // spends the user's mobile data for a deploy that happens once a week.
      // 6 hours, plus an immediate check when the app regains focus.
      setInterval(checkForUpdate, 6 * 60 * 60 * 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Activate the new worker; the app surfaces a reload prompt.
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
