// MERIDIAN v5.50.0 — cache reset / network only
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
    self.registration.unregister()
  ]).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request, {cache:'no-store'}));
});
