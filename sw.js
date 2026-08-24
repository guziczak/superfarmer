// Superfarmer 3D — cache offline (network-first: online zawsze świeża wersja).
const VER = 'sf3d-6fbda2ed1b';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(['./'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const copy = resp.clone();
        caches.open(VER).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return resp;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))
    )
  );
});
