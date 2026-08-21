const CACHE='meridian-v382-2026-08-21-2135';
const SHELL=['./styles.css?v=382','./app.js?v=382','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)))}); 
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 const fresh=u.pathname.endsWith('/index.html')||u.pathname.endsWith('/data.json')||u.pathname.endsWith('/version.json')||u.pathname.endsWith('/meridian/');
 if(fresh){e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request)));return;}
 e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const c=resp.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c));return resp})));
});
