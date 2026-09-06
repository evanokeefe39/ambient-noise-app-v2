/**
 * Ambient Noise — Service Worker
 * Network-first for navigation/API; cache-first for hashed static assets.
 * CACHE_NAME is bumped per release (build stamps CACHE_VERSION) so activation
 * purges the previous cache and clients refetch changed files. A page that is
 * already controlled detects the new worker, asks it to skipWaiting(), and the
 * resulting controllerchange triggers a single reload to serve the fresh build.
 */
const CACHE_NAME = 'ambient-v2-__CACHE_VERSION__';

// Core assets to precache at install time
const PRECACHE_URLS = [
  '/worklets/white-noise-processor.js',
  '/worklets/pink-noise-processor.js',
  '/worklets/brown-noise-processor.js',
  '/manifest.json',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
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
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Cache-first for worklets and Next.js static assets
  if (
    url.pathname.startsWith('/worklets/') ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Network-first for navigation and API requests
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
