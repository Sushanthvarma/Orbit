/* Orbit Web — service worker (offline cache) */
const CACHE = 'orbit-web-v43';
// Only precache assets the page actually requests at the exact URL.
// JS/CSS are versioned via `?v=` query, so they're fetched live on first
// load and then cache-first on repeat visits via the fetch handler below.
const ASSETS = [
  './',
  './index.html',
  './landing.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML AND for versioned JS/CSS (anything with `?v=`
  // in the query string). Cache-first only for static assets like icons.
  const isHTML = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
  const isVersionedAsset = url.search.includes('v=');

  if (isHTML || isVersionedAsset) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache successful 2xx responses.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Stale-while-revalidate for everything else (icons, fonts, etc).
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});