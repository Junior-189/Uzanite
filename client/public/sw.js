const CACHE_NAME = 'uzanite-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
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

  // Cross-origin (e.g. Cloudinary images): network only — don't cache
  // opaque responses, which is unreliable inside a service worker.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 504 })));
    return;
  }

  // API requests: network only. If it fails, surface the error (the app
  // handles offline via IndexedDB) instead of throwing in the SW.
  if (request.url.includes('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 504, statusText: 'offline' })));
    return;
  }

  // Navigation requests (app shell): network first, fall back to cached
  // index.html when offline so the app still loads.
  if (request.mode === 'navigate' || request.url.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || new Response('', { status: 504 })))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched || new Response('', { status: 504, statusText: 'offline' });
    })
  );
});
