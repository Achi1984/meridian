// ACHI MERIDIAN v5.4.0 — legacy cache killer
const CACHE='meridian-v5.20.0-hedge-optimizer';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.registration.unregister()).then(()=>self.clients.claim())));
self.addEventListener('fetch',()=>{});
