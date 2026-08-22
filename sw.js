const CACHE='meridian-v5.2.1-render-hotfix-20260822';
const ASSETS=['./','./index.html','./styles.css','./app.js','./data.json','./history.json','./version.json','./manifest.webmanifest','./achi-meridian-logo.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));

self.addEventListener('install',()=>self.skipWaiting());

self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
