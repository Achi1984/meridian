import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAccess} from '../v11/app-access.js';
import {createDepotReadView} from '../v11/depot-read-view.js';
import {createDepotReadClient} from '../v11/depot-read-client.js';
import {mountDepotReadAccess} from '../v11/depot-read-bootstrap.js';
import {subscribeDepotPortfolio} from '../v11/depot-portfolio-state.js?v=B16-M11-FIX6';
class Node {
  constructor(document,tag){this.ownerDocument=document;this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners=new Map();this.text='';}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  click(){for(const fn of this.listeners.get('click')||[])fn();}
  find(tag,text){return this.tagName===tag&&this.text===text?this:this.children.map(c=>c.find?.(tag,text)).find(Boolean);}
}
function setup({status=200}={}){
  const d={createElement:t=>new Node(d,t),createElementNS:(_n,t)=>new Node(d,t)};
  const root=d.createElement('div'),command=d.createElement('div');
  const fields=new Map(['.portfolio-value','.state-label','.portfolio-description','.caption','[data-command-depot-status]'].map(s=>[s,d.createElement('span')]));
  command.querySelector=s=>fields.get(s);
  d.getElementById=id=>id==='depot-read-root'?root:id==='command-portfolio'?command:null;
  const urls=[];
  const fetchImpl=async url=>{urls.push(url);return new Response(JSON.stringify(url.includes('portfolio-history')?{points:[]}:{}),{status});};
  const access=createAppAccess({fetchImpl});
  const h={d,root,command,fields,urls,access,fetchImpl,fetchFor:fetchImpl,
    text:()=>root.textContent};
  return h;
}
// Real createAppAccess + real createDepotReadView/createDepotReadClient, synthetic data only.
function mountReal(h){
  return mountDepotReadAccess(h.d,{},{access:h.access,createClient:o=>createDepotReadClient({...o,fetchImpl:(u,i)=>h.fetchFor(u,i)})});
}
test('locked start, central verify gives not_loaded with no extra Depot reads, Command aligned',async()=>{
  const h=setup();const m=mountReal(h);
  assert.match(h.text(),/Gesperrt/);assert.equal(h.urls.length,0);
  assert.equal(await h.access.verify('synthetic-password'),'unlocked');
  const afterVerify=h.urls.length;
  assert.equal(afterVerify,1,'only the central verify request');
  assert.match(h.text(),/Noch nicht geladen/);assert.match(h.text(),/Depot manuell aktualisieren/);
  assert.equal(h.command.dataset.state,'not_loaded');
  assert.match(h.fields.get('[data-command-depot-status]').textContent,/Noch nicht geladen/);
  assert.equal(h.fields.get('.portfolio-value').textContent,'—');
  assert.ok(h.access.isUnlocked());
  m.dispose();
});
test('already unlocked mount starts not_loaded without reads',async()=>{
  const h=setup();await h.access.verify('synthetic-password');
  const before=h.urls.length;const m=mountReal(h);
  assert.match(h.text(),/Noch nicht geladen/);assert.equal(h.urls.length,before);m.dispose();
});
test('manual refresh reads, reports unavailable categories; revalidation preserves it; lock and re-unlock reset',async()=>{
  const h=setup();const m=mountReal(h);await h.access.verify('synthetic-password');
  const before=h.urls.length;
  h.root.find('button','Depot aktualisieren').click();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(h.urls.length-before,3);
  assert.equal(h.root.children[1].dataset.state,'unavailable');
  assert.match(h.text(),/Nicht verfügbar/);assert.match(h.text(),/Aktuell: unvollständig/);
  assert.equal(h.fields.get('.portfolio-description').textContent,'Keine verifizierbare Depotbewertung. Fehlende Daten sind nicht null.');
  assert.match(h.fields.get('.caption').textContent,/Aktuell: unvollständig/);
  assert.doesNotMatch(h.fields.get('.caption').textContent,/Keine verifizierbare Depotbewertung/);
  assert.equal(h.fields.get('.caption').hidden,false);
  assert.doesNotMatch(h.text(),/synthetic-password/);
  h.access.revalidateReaders();
  assert.equal(h.root.children[1].dataset.state,'unavailable','attempted state is not replaced by not_loaded');
  h.access.lock();
  assert.match(h.text(),/Gesperrt/);assert.equal(h.command.dataset.state,'locked');
  assert.equal(h.fields.get('.caption').textContent,'');
  assert.equal(h.fields.get('.caption').hidden,true);
  await h.access.verify('synthetic-password');
  assert.match(h.text(),/Noch nicht geladen/);
  m.dispose();
});
test('401 on a manual read globally locks; dispose unsubscribes and late completion is ignored',async()=>{
  let denyDepot=false;
  const h=setup();
  const real=h.fetchImpl;
  const guarded=async(url,o)=>denyDepot&&!url.includes('binance')?new Response('{}',{status:401}):real(url,o);
  const access=createAppAccess({fetchImpl:guarded});
  h.access=access;h.fetchFor=guarded;
  const m=mountReal(h);await access.verify('synthetic-password');
  denyDepot=true;
  h.root.find('button','Depot aktualisieren').click();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(access.isUnlocked(),false);assert.match(h.text(),/Gesperrt/);
  denyDepot=false;await access.verify('synthetic-password');
  assert.match(h.text(),/Noch nicht geladen/);
  h.root.find('button','Depot aktualisieren').click();
  m.dispose();
  await new Promise(r=>setTimeout(r,20));
  assert.equal(h.root.children.length,0);
  assert.equal(await access.verify('synthetic-password'),'unlocked');
  assert.equal(h.root.children.length,0);
  access.dispose();
});

// Generated fixtures for fresh / independently valid cases (synthetic values only).
const NOW=Date.parse('2026-10-13T20:00:00Z'),iso=x=>new Date(x).toISOString();
const history=(points=true)=>({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',source:'POSTGRES_CANONICAL_HISTORY',
  rawPointCount:points?1:0,excludedIncompletePoints:0,generatedAt:iso(NOW),points:points?[{timestamp:NOW-1000,spotUsd:120,tradingUsd:30,totalUsd:150,
    sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',
      tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:NOW-2000}}]:[]});
const dashboard=()=>({private:true,data:{portfolio:{ledgerAuthorityAt:iso(NOW-10000),
  holdings:[{venue:'Ledger',symbol:'BTC',quantity:2}],
  manualVenueBalances:[{venue:'OKX',valueUsd:50,updatedAt:iso(NOW-20000),source:'USER_CONFIRMED_PORTFOLIO_AUTHORITY'}],
  pionexEquityUsd:30,pionexEquityUpdatedAt:iso(NOW-30000),pionexEquitySource:'PRIVATE_PORTFOLIO_SNAPSHOT'}}});
const prices=()=>[{symbol:'BTCUSDT',price:'100.00'}];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
const kindOf=url=>url.includes('/dashboard')?'dashboard':url.includes('portfolio-history')?'history':'prices';
// bodies: kind -> body | Response factory | 'defer'; the verify endpoint is the history URL and answered by access.
function harness(bodies){
  const h=setup();let clock=NOW,verified=false;const states=[],deferred={},reads=[];let refreshed=null;
  const access=createAppAccess({fetchImpl:async()=>json({})});
  h.access=access;
  h.fetchFor=(url)=>{
    const kind=kindOf(url);reads.push(kind);
    const spec=bodies[kind];
    if(spec==='defer')return new Promise(resolve=>{deferred[kind]=resolve;});
    return Promise.resolve(spec instanceof Response?spec.clone():json(spec));
  };
  const m=mountDepotReadAccess(h.d,{},{access,createClient:o=>{
    const c=createDepotReadClient({...o,now:()=>clock,fetchImpl:(u,i)=>h.fetchFor(u,i),onChange:s=>{states.push(s);o.onChange(s);}});
    return {...c,refresh(){refreshed=c.refresh();return refreshed;}};
  }});
  const click=()=>h.root.find('button','Depot aktualisieren').click();
  return {h,m,states,deferred,reads,access,click,
    clock:v=>{clock=v;},done:()=>refreshed,last:()=>states.at(-1),
    state:()=>h.root.children[1].dataset.state};
}
test('fresh current and history; fresh→stale revalidation never keeps OK reasons',async()=>{
  const t=harness({dashboard:dashboard(),prices:prices(),history:history()});
  const portfolioStates=[];const unsubscribe=subscribeDepotPortfolio(state=>portfolioStates.push(state));
  await t.access.verify('synthetic-password');
  assert.equal(t.last().status,'not_loaded');
  t.click();await t.done();
  assert.equal(t.last().status,'fresh');assert.equal(t.last().model.source,'SERVER_PORTFOLIO_CURRENT');assert.equal(t.last().model.totalUsd,280);
  assert.equal(portfolioStates.at(-1).model.totalUsd,280);assert.equal(portfolioStates.at(-1).model.currency,'USD');
  assert.equal(portfolioStates.at(-1).model.snapshotAt,t.last().model.snapshotAt);
  assert.equal(t.reads.length,3,'Bots consume the canonical Depot state without another read');
  assert.deepEqual(t.last().reasons,{current:'OK',prices:'RECEIVED',history:'OK'});
  assert.equal(t.h.command.dataset.state,'fresh');
  // current expires first; the independently valid stored history remains
  t.clock(NOW+200000);t.access.revalidateReaders();
  assert.equal(t.last().status,'fresh');assert.equal(t.last().model.source,'POSTGRES_CANONICAL_HISTORY');
  assert.deepEqual(t.last().reasons,{current:'STALE',prices:'RECEIVED',history:'OK'});
  t.clock(NOW+1000000);t.access.revalidateReaders();
  assert.equal(t.last().status,'stale');assert.equal(t.state(),'stale');
  assert.equal(portfolioStates.at(-1).model,null,'stale totals are cleared for every subscriber');
  assert.deepEqual(t.last().reasons,{current:'STALE',prices:'RECEIVED',history:'STALE'});
  assert.match(t.h.text(),/Aktuell: veraltet · Historie: veraltet/);assert.doesNotMatch(t.h.text(),/: OK/);
  assert.equal(t.reads.length,3,'revalidation never reads');
  unsubscribe();
  t.m.dispose();
});
test('independently valid current or history survive a failure of the other source',async()=>{
  const a=harness({dashboard:{},prices:prices(),history:history()});
  await a.access.verify('synthetic-password');a.click();await a.done();
  assert.equal(a.last().status,'fresh');assert.equal(a.last().model.source,'POSTGRES_CANONICAL_HISTORY');
  assert.deepEqual(a.last().reasons,{current:'INCOMPLETE',prices:'RECEIVED',history:'OK'});a.m.dispose();
  const b=harness({dashboard:dashboard(),prices:prices(),history:new Response('x',{status:500})});
  await b.access.verify('synthetic-password');b.click();await b.done();
  assert.equal(b.last().status,'fresh');assert.equal(b.last().model.source,'SERVER_PORTFOLIO_CURRENT');
  assert.deepEqual(b.last().reasons,{current:'OK',prices:'RECEIVED',history:'TRANSPORT'});b.m.dispose();
  const c=harness({dashboard:dashboard(),prices:prices(),history:history(false)});
  await c.access.verify('synthetic-password');c.click();await c.done();
  assert.equal(c.last().status,'fresh');assert.equal(c.last().reasons.history,'EMPTY','valid empty history is not unavailable-current');
  c.m.dispose();
  const d=harness({dashboard:{},prices:new Response('x',{status:500}),history:history(false)});
  await d.access.verify('synthetic-password');d.click();await d.done();
  assert.equal(d.last().status,'unavailable');
  assert.deepEqual(d.last().reasons,{current:'INCOMPLETE',prices:'TRANSPORT',history:'EMPTY'});
  assert.match(d.h.text(),/Aktuell: unvollständig · Kurse: nicht erreichbar · Historie: keine vollständigen Bewertungen im Zeitraum/);d.m.dispose();
});
test('history reason: excluded-only is EMPTY, malformed is INCOMPLETE, current stays independent',async()=>{
  const excludedOnly={...history(false),rawPointCount:2,excludedIncompletePoints:2};
  const e=harness({dashboard:dashboard(),prices:prices(),history:excludedOnly});
  await e.access.verify('synthetic-password');e.click();await e.done();
  assert.equal(e.last().status,'fresh');assert.equal(e.last().model.source,'SERVER_PORTFOLIO_CURRENT');
  assert.equal(e.last().reasons.history,'EMPTY');e.m.dispose();
  for(const bad of [{...history(false),version:'old'},{...history(false),source:'OTHER'},{...history(false),rawPointCount:3}]){
    const t=harness({dashboard:{},prices:prices(),history:bad});
    await t.access.verify('synthetic-password');t.click();await t.done();
    assert.equal(t.last().status,'unavailable');assert.equal(t.last().reasons.history,'INCOMPLETE');
    assert.match(t.h.text(),/Historie: unvollständig/);assert.doesNotMatch(t.h.text(),/keine vollständigen Bewertungen/);t.m.dispose();
  }
  const l=harness({dashboard:dashboard(),prices:prices(),history:history(false)});
  await l.access.verify('synthetic-password');l.click();await l.done();
  l.access.lock();assert.equal(l.last().status,'locked');assert.equal(l.last().reasons,null);assert.equal(l.last().model,null);l.m.dispose();
});
test('revalidation while loading neither resets nor refetches',async()=>{
  const t=harness({dashboard:'defer',prices:'defer',history:'defer'});
  await t.access.verify('synthetic-password');
  t.click();assert.equal(t.last().status,'loading');assert.equal(t.reads.length,3);
  const count=t.states.length;
  t.access.revalidateReaders();
  assert.equal(t.states.length,count,'no emission, no reset to not_loaded');assert.equal(t.reads.length,3);assert.equal(t.state(),'loading');
  t.deferred.dashboard(json(dashboard()));t.deferred.prices(json(prices()));t.deferred.history(json(history()));
  await t.done();
  assert.equal(t.last().status,'fresh');assert.equal(t.reads.length,3);t.m.dispose();
});
test('deferred completion after dispose is ignored deterministically',async()=>{
  const t=harness({dashboard:'defer',prices:'defer',history:'defer'});
  await t.access.verify('synthetic-password');
  t.click();assert.equal(t.last().status,'loading');
  t.m.dispose();const count=t.states.length;
  t.deferred.dashboard(json(dashboard()));t.deferred.prices(json(prices()));t.deferred.history(json(history()));
  await t.done();
  assert.equal(t.states.length,count,'late completion emits nothing');
  assert.equal(t.h.root.children.length,0);assert.equal(t.h.fields.get('.portfolio-value').textContent,'—');
  assert.equal(t.access.isUnlocked(),false);
});

test('source diagnosis survives model/client/view projection and is erased on lock without extra reads',async()=>{
  const p=dashboard();p.data.portfolio.manualVenueBalances[0].updatedAt=iso(NOW-86400001);
  const t=harness({dashboard:p,prices:prices(),history:history(false)});
  await t.access.verify('synthetic-password');t.click();await t.done();
  assert.equal(t.last().status,'unavailable');assert.equal(t.last().model,null);
  assert.deepEqual(t.last().sourceIssues,['OKX_SOURCE_STALE']);
  assert.match(t.h.text(),/OKX-Bewertungsquelle ist veraltet/);
  assert.equal(t.reads.length,3);assert.doesNotMatch(t.h.text(),/BTC|synthetic-password|2026-10-12/);
  t.access.revalidateReaders();assert.deepEqual(t.last().sourceIssues,['OKX_SOURCE_STALE']);assert.equal(t.reads.length,3);
  t.access.lock();assert.deepEqual(t.last().sourceIssues,[]);assert.doesNotMatch(t.h.text(),/OKX-Bewertungsquelle/);t.m.dispose();
});
test('revalidation reports expiry of the held projection without falsely blaming an individual source',async()=>{
  const t=harness({dashboard:dashboard(),prices:prices(),history:history(false)});
  await t.access.verify('synthetic-password');t.click();await t.done();assert.deepEqual(t.last().sourceIssues,[]);
  t.clock(NOW+200000);t.access.revalidateReaders();
  assert.deepEqual(t.last().sourceIssues,['CURRENT_SNAPSHOT_EXPIRED']);
  assert.match(t.h.text(),/inzwischen abgelaufen/);assert.doesNotMatch(t.h.text(),/OKX-Bewertungsquelle|Pionex-Gesamteigenkapital ist/);
  assert.equal(t.reads.length,3);t.m.dispose();
});

test('source detail rendering accepts fixed codes only and clears prior diagnosis on lock',()=>{
  const h=setup();let render;
  const view=createDepotReadView(h.root,{createClient:options=>{
    render=options.onChange;return {refresh(){},lock(){render({status:'locked'});},revalidate(){},dispose(){}};
  }});
  render({status:'unavailable',sourceIssues:['secret-wallet-token','OKX_SOURCE_STALE','OKX_SOURCE_STALE']});
  assert.match(h.text(),/OKX-Bewertungsquelle ist veraltet/);
  assert.doesNotMatch(h.text(),/secret-wallet-token/);
  assert.equal(h.text().split('OKX-Bewertungsquelle ist veraltet.').length-1,1);
  render({status:'locked'});assert.doesNotMatch(h.text(),/OKX-Bewertungsquelle/);view.dispose();
});

test('Pionex-only view excludes mixed history and rejects aggregate models',()=>{
  const h=setup();let render;
  const v=createDepotReadView(h.root,{pionexOnly:true,commandRoot:h.command,getToken:()=>null,
    createClient:o=>{render=o.onChange;return {dispose(){},revalidate(){},refresh(){},lock(){}};}});
  const model={status:'FRESH_SNAPSHOT',readOnly:true,executionAllowed:false,totalUsd:3450,spotUsd:null,tradingUsd:3450,
    currency:'USD/USDT',snapshotAt:'2026-10-31T18:00:00Z',sourceAt:'2026-10-31T18:00:00Z',expiresAt:1793469900000,source:'SERVER_PIONEX_CURRENT'};
  render({status:'fresh',model,history:{'1d':{status:'FRESH_SNAPSHOT',points:[{totalUsd:999999}]}}});
  assert.match(h.text(),/3.450,00 USD\/USDT/);assert.match(h.text(),/Pionex-Verlauf/);
  assert.match(h.text(),/Verlauf nicht verfügbar/);assert.doesNotMatch(h.text(),/999.999|Spot laut Depotquelle|Ledger|OKX/);
  assert.match(h.fields.get('.portfolio-description').textContent,/Pionex/);
  render({status:'fresh',model:{...model,source:'SERVER_PORTFOLIO_CURRENT',spotUsd:2000}});
  assert.equal(h.command.dataset.state,'unavailable');assert.doesNotMatch(h.text(),/3.450,00/);v.dispose();
});

