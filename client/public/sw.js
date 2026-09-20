// UZANITE service worker.
//
// Cache strategy is VERSIONED: `activate` deletes only caches from previous
// versions, never the current one. Previously it wiped every cache on every
// activate, which meant that a routine deploy threw away the entire precached
// app shell and forced a full re-download on exactly the slow connections that
// can least afford it.
//
// Bump VERSION on a release that changes caching behaviour.
const VERSION = 'v3';
const STATIC_CACHE = `uzanite-static-${VERSION}`;
const RUNTIME_CACHE = `uzanite-runtime-${VERSION}`;
const KEEP = new Set([STATIC_CACHE, RUNTIME_CACHE]);

// Resolved relative to the service worker scope, so this works under /admin/.
const APP_SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(APP_SHELL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (e.g. CDN images): network only — don't cache opaque
  // responses, which is unreliable inside a service worker.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 504 })));
    return;
  }

  // API requests: network only. If it fails, surface the error (the app
  // handles offline via IndexedDB) instead of throwing in the SW.
  if (url.pathname.includes('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 504, statusText: 'offline' })));
    return;
  }

  // Navigation requests (app shell): network first, fall back to the cached
  // shell when offline so the app still loads.
  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(APP_SHELL, clone));
          return response;
        })
        .catch(() => caches.match(APP_SHELL).then((cached) => cached || new Response('', { status: 504 })))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched || new Response('', { status: 504, statusText: 'offline' });
    })
  );
});
