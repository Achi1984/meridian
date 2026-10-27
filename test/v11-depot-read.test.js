import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDepotReadModel} from '../v11/depot-read-model.js';
import {createDepotReadClient,parseDepotReadCredential} from '../v11/depot-read-client.js';
import {mountDepotReadAccess} from '../v11/depot-read-bootstrap.js';
const NOW=Date.parse('2026-10-13T20:00:00Z');
function snapshot(){return {version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',source:'POSTGRES_CANONICAL_HISTORY',
  rawPointCount:1,excludedIncompletePoints:0,generatedAt:new Date(NOW).toISOString(),points:[{timestamp:NOW-1000,
    spotUsd:120,tradingUsd:30,totalUsd:150,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',
      tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:NOW-2000}}]};}
test('B7 accepts a complete stored valuation, including genuine zero, with source expiry',()=>{
  const s=snapshot(),m=buildDepotReadModel(s,{now:NOW});
  assert.equal(m.status,'FRESH_SNAPSHOT');assert.equal(m.totalUsd,150);assert.equal(m.expiresAt,NOW-2000+900000);
  assert.equal(m.readOnly,true);assert.equal(m.executionAllowed,false);
  s.points[0].spotUsd=s.points[0].tradingUsd=s.points[0].totalUsd=0;
  assert.equal(buildDepotReadModel(s,{now:NOW}).totalUsd,0);
});
test('B7 rejects malformed, partial, inconsistent and unknown provenance without numeric fallback',()=>{
  const changes=[s=>{s.source='NO_DATABASE';},s=>{s.version='old';},s=>{s.points=[];},
    s=>{s.rawPointCount=2;},s=>{s.excludedIncompletePoints=-1;},s=>{s.points[0].totalUsd=999;},
    s=>{s.points[0].sourceStatus.spot='STRICT_PARTIAL';},s=>{s.points[0].sourceStatus.tradingFresh=false;},
    s=>{s.points[0].sourceStatus.tradingSource='MISSING';},s=>{s.points[0].timestamp=NOW+1;},
    s=>{s.points[0].sourceStatus.tradingUpdatedAt=NOW;},
    s=>{s.points[0].sourceStatus.tradingUpdatedAt='2026-02-30T00:00:00Z';}];
  for(const field of ['totalUsd','spotUsd','tradingUsd'])for(const value of [null,'0',true,NaN,Infinity,-1])
    changes.push(s=>{s.points[0][field]=value;});
  for(const change of changes){const s=snapshot();change(s);const m=buildDepotReadModel(s,{now:NOW});
    assert.equal(m.status,'UNKNOWN');assert.equal(m.totalUsd,null);}
});
test('B7 ages capture and source independently and does not use generatedAt or older fallback',()=>{
  const s=snapshot();s.points[0].sourceStatus.tradingUpdatedAt=NOW-900001;
  assert.equal(buildDepotReadModel(s,{now:NOW}).status,'STALE');
  s.points[0].timestamp=NOW-900001;s.points[0].sourceStatus.tradingUpdatedAt=NOW-900002;
  assert.equal(buildDepotReadModel(s,{now:NOW}).status,'STALE');
  const bad=snapshot();bad.points.push({...bad.points[0],timestamp:NOW,totalUsd:null});bad.rawPointCount=2;
  assert.equal(buildDepotReadModel(bad,{now:NOW}).totalUsd,null);
  const gap=snapshot();gap.rawPointCount=3;gap.excludedIncompletePoints=2;
  assert.equal(buildDepotReadModel(gap,{now:NOW}).excludedIncompletePoints,2);
});
test('B7 rejects bot-share and foreign URLs before making any request',async()=>{
  for(const value of ['https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/asset-watch?share='+'a'.repeat(43),
    'https://foreign.example/token','//foreign.example','bad\nsecret','']){
    assert.equal(parseDepotReadCredential(value),null);let reads=0;
    const c=createDepotReadClient({getToken:()=>value,fetchImpl:()=>{reads++;}});await c.refresh();assert.equal(reads,0);c.dispose();
  }
  assert.deepEqual(parseDepotReadCredential('a'.repeat(43)),{kind:'bearer',value:'a'.repeat(43)});
});
test('B7 fixed GET only, bounded body, no mount read, no credential/error leakage',async()=>{
  const states=[];let reads=0;
  const c=createDepotReadClient({getToken:()=> 'synthetic-password',now:()=>NOW,onChange:s=>states.push(s),fetchImpl:async(url,o)=>{
    reads++;assert.ok(['https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/portfolio-history?range=1w','https://p01--achi-meridian--ttvk44grdlp7.code.run/api/private/dashboard','https://data-api.binance.vision/api/v3/ticker/price'].includes(url));
    assert.equal(o.method,'GET');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
    assert.equal(o.headers.authorization,url.includes('binance.vision')?undefined:'Bearer synthetic-password');return new Response(JSON.stringify(snapshot()));}});
  assert.equal(reads,0);await c.refresh();assert.equal(states.at(-1).status,'fresh');
  c.lock();assert.equal(states.at(-1).model,null);assert.doesNotMatch(JSON.stringify(states),/synthetic-password/);c.dispose();
  for(const response of [new Response('secret error',{status:500}),new Response('bad json'),
    new Response('{}',{headers:{'content-length':String(512*1024+1)}}),new Response(' '.repeat(512*1024+1))]){
    const out=[];const client=createDepotReadClient({getToken:()=> 'pass',onChange:s=>out.push(s),fetchImpl:async()=>response});
    await client.refresh();assert.equal(out.at(-1).status,'unavailable');assert.doesNotMatch(JSON.stringify(out),/secret error/);client.dispose();
  }
});
test('B7 late response cannot refill locked state and changed credential aborts pending work',async()=>{
  for(const changed of [false,true]){
    let resolvers=[],credential='first';const states=[];
    const c=createDepotReadClient({getToken:()=>credential,now:()=>NOW,onChange:s=>states.push(s),
      fetchImpl:()=>new Promise(r=>{resolvers.push(r);})});
    const pending=c.refresh();if(changed){credential='second';c.revalidate();}else c.lock();
    for(const resolve of resolvers)resolve(new Response(JSON.stringify(snapshot())));await pending;assert.equal(states.at(-1).status,'locked');c.dispose();
  }
});
class Target{
  constructor(){this.listeners=new Map();this.value='';this.textContent='';}
  addEventListener(k,f){if(!this.listeners.has(k))this.listeners.set(k,new Set());this.listeners.get(k).add(f);}
  removeEventListener(k,f){this.listeners.get(k)?.delete(f);}
  fire(k){for(const f of this.listeners.get(k)||[])f();}
}
function accessController(){
  let credential=null;const readers=new Map();
  return {getToken:()=>credential,isUnlocked:()=>credential!==null,set(value){credential=value;},
    lock(){credential=null;for(const clear of readers.keys())clear();},
    revalidateReaders(){if(!credential)return false;for(const revalidate of readers.values())revalidate();return true;},
    registerReader(clear,revalidate=()=>{}){readers.set(clear,revalidate);return ()=>readers.delete(clear);}};
}
function mounted(response){
  const document=new Target(),window=new Target(),nodes=new Map(['root'].map(n=>['depot-read-'+n,new Target()]));
  document.getElementById=id=>nodes.get(id);
  const access=accessController();
  let client,token,reads=0,clock=NOW;const states=[],timers=new Map();let next=0;
  const mount=mountDepotReadAccess(document,window,{access,now:()=>clock,schedule:(f,ms)=>{timers.set(++next,{f,ms});return next;},cancelSchedule:id=>timers.delete(id),
    createClient:options=>{token=options.getToken;return createDepotReadClient({...options,now:()=>clock,fetchImpl:async()=>{reads++;return response();}});},
    createView:(_r,o)=>{client=o.createClient({getToken:o.getToken,onChange:s=>states.push(s)});return {revalidate:()=>client.revalidate(),dispose:()=>client.dispose()};}});
  return {document,window,nodes,states,timers,mount,client:()=>client,access,token:()=>token(),reads:()=>reads,
    clock(value){clock=value;}};
}
test('B7 foreground revalidation preserves the locked state before the first private read',()=>{
  const states=[],c=createDepotReadClient({getToken:()=> 'synthetic-password',onChange:s=>states.push(s.status)});
  c.revalidate();
  assert.deepEqual(states,[]);
  c.dispose();
});
test('B7 uses shared access and manual reads; 401/403 revoke the shared credential',async()=>{
  for(const code of [200,401,403]){
    const h=mounted(()=>new Response(JSON.stringify(snapshot()),{status:code}));h.access.set('synthetic-password');
    assert.equal(h.reads(),0);await h.client().refresh();
    if(code!==200){assert.equal(h.token(),null);assert.equal(h.states.at(-1).status,'locked');}
    h.access.lock();assert.equal(h.token(),null);h.mount.dispose();
  }
});
test('B7 expiry invalidates foreground valuation without polling; rejected replacement clears access',async()=>{
  const h=mounted(()=>new Response(JSON.stringify(snapshot())));h.access.set('synthetic-password');await h.client().refresh();
  assert.equal(h.timers.size,1);const timer=[...h.timers.values()][0];assert.equal(timer.ms,898001);
  h.clock(NOW+898001);timer.f();assert.equal(h.states.at(-1).status,'stale');assert.equal(h.reads(),3);
  h.access.set('https://foreign.example');await h.client().refresh();assert.equal(h.token(),null);h.mount.dispose();
});

test('shared foreground revalidation stales cached Depot projections without reading',async()=>{
  const h=mounted(()=>new Response(JSON.stringify(snapshot())));
  h.access.set('synthetic-password');
  await h.client().refresh();
  assert.equal(h.states.at(-1).status,'fresh');
  assert.equal(h.reads(),3);
  h.clock(NOW+898001);
  h.access.revalidateReaders();
  assert.equal(h.access.getToken(),'synthetic-password','the source expiry is inside the app session');
  assert.equal(h.states.at(-1).status,'stale');
  assert.equal(h.reads(),3,'foreground revalidation does not issue requests');
  h.mount.dispose();
});

test('B8 current value survives history failure; public price call never receives credentials',async()=>{
 const out=[],calls=[];
 const portfolio={holdings:[],manualVenueBalances:[{venue:'Ledger',valueUsd:100,updatedAt:NOW-1000},{venue:'OKX',valueUsd:20,updatedAt:NOW-1000}],pionexEquityUsd:30,pionexEquityUpdatedAt:NOW-1000};
 const c=createDepotReadClient({getToken:()=> 'password',now:()=>NOW,onChange:s=>out.push(s),fetchImpl:async(url,o)=>{
  calls.push(url);if(url.includes('binance')){assert.equal(o.headers.authorization,undefined);return new Response('[]');}
  assert.equal(o.headers.authorization,'Bearer password');
  return url.includes('/dashboard')?new Response(JSON.stringify({private:true,data:{portfolio}})):new Response('{}',{status:503});
 }});
 await c.refresh();assert.equal(out.at(-1).model.totalUsd,150);assert.equal(out.at(-1).model.source,'SERVER_PORTFOLIO_CURRENT');assert.equal(out.at(-1).history['1w'].status,'unavailable');
 assert.equal(calls.length,3);c.lock();assert.equal(out.at(-1).history,null);assert.equal(out.at(-1).model,null);c.dispose();
});
test('B8 any private auth rejection revokes all value and chart access',async()=>{
 const out=[];const c=createDepotReadClient({getToken:()=> 'password',onChange:s=>out.push(s),fetchImpl:async url=>new Response('{}',{status:url.includes('/dashboard')?403:200})});
 await c.refresh();assert.equal(out.at(-1).status,'locked');assert.equal(out.at(-1).history,null);c.dispose();
});
