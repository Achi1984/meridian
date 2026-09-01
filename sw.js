// MERIDIAN_SW_RETIRE — v7.35
// One-release retirement worker: remove legacy MERIDIAN caches and unregister itself.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>/meridian/i.test(k)).map(k=>caches.delete(k)));
    await self.registration.unregister();
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){
      try{client.postMessage({type:'MERIDIAN_SW_RETIRED',version:'7.35'})}catch(_e){}
    }
  })());
});
self.addEventListener('fetch',()=>{});
