const CACHE='meridian-github-v2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./data.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{
    const clone=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)); return r;
  }).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
