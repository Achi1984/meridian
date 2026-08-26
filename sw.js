const CACHE='meridian-v6.02';
const SHELL=['./','./index.html','./data.json','./manifest.webmanifest'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{})
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE && /meridian/i.test(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  const isNav=req.mode==='navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');

  if(isNav){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:'no-store'});
        const c=await caches.open(CACHE);
        c.put('./index.html',fresh.clone()).catch(()=>{});
        return fresh;
      }catch(_){
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(req);
    const refresh=fetch(req).then(async fresh=>{
      if(fresh && fresh.ok){
        const c=await caches.open(CACHE);
        c.put(req,fresh.clone()).catch(()=>{});
      }
      return fresh;
    }).catch(()=>null);
    return cached || await refresh || Response.error();
  })());
});
