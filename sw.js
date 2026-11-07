// Cache wyłącznie plików tej gry, w obrębie jej własnej ścieżki.
const SCOPE = new URL(self.registration.scope);
const PREFIX = 'sf3d-v2-' + encodeURIComponent(SCOPE.pathname) + '-';
const CACHE = PREFIX + '13715be0e3';
const FILES = ['./', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const PATHS = FILES.concat(['./index.html']).map((path) => new URL(path, SCOPE).pathname);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !PATHS.includes(url.pathname)) return;
  const isDocument = url.pathname === SCOPE.pathname || url.pathname === new URL('./index.html', SCOPE).pathname;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        event.waitUntil(cache.put(request, copy).catch(() => {}));
      }
      return response;
    } catch (error) {
      const stored = await cache.match(request, { ignoreSearch: true });
      if (stored) return stored;
      if (isDocument) {
        const home = await cache.match(new URL('./', SCOPE).href);
        if (home) return home;
      }
      return Response.error();
    }
  })());
});
