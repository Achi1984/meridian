// MERIDIAN v5.87 cache reset
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{
for(const k of await caches.keys())await caches.delete(k);
await self.registration.unregister();await self.clients.claim();
})()));