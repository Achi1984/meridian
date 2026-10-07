import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMarketRefreshController,marketEvidence} from '../v9/market-refresh-state.mjs';

const source=readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const start=source.indexOf('function ema('),end=source.indexOf('\nfunction risk(b)',start);
assert.ok(start>=0&&end>start,'production market adapter must be present');
const production=source.slice(start,end);
const T=Date.UTC(2026,9,7,8,0,0),SPAN={'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
function responseRows(interval,limit,time,down=false){
  const span=SPAN[interval];
  return Array.from({length:limit},(_,i)=>{
    const close=down?200-i*.1-Math.max(0,i-limit+25)*.2:100+i*.05;
    const openTime=time-(limit-i)*span;
    return{openTime,closeTime:openTime+span-1,high:close+1,low:close-1,close};
  });
}
function harness(){
  const state={intel:null,assetIntel:{},priceChecks:{},marketSyncedAt:null,marketSyncStatus:'IDLE',marketTransport:null,lastGoodMarketSnapshot:null};
  const h={state,clock:T,sourceAt:T,calls:[],faults:new Map(),notifications:[],direct:false,down:false,symbols:['BTC','ETH','SOL']};
  class Clock extends Date{static now(){return h.clock}}
  const getJson=async path=>{
    const u=new URL(path,'https://synthetic.invalid'),symbol=u.searchParams.get('symbol'),interval=u.searchParams.get('interval'),limit=Number(u.searchParams.get('limit'));
    h.calls.push({kind:'gateway',symbol,interval});
    const out={ok:true,rows:responseRows(interval,limit,h.clock,h.down),source:'SYNTHETIC',fetchedAt:h.sourceAt,ageMs:h.clock-h.sourceAt,cache:'HIT'};
    const change=h.faults.get(symbol+':'+interval)||h.faults.get(symbol);
    return change?await change(out):out;
  };
  const fetchTimed=async url=>{
    h.calls.push({kind:'direct',url});
    if(url.includes('/tickers?'))return{ok:true,json:async()=>({data:[]})};
    if(url.includes('/ticker/price'))return{ok:true,json:async()=>[]};
    if(!h.direct)throw new Error('synthetic direct transport unavailable');
    const u=new URL(url),bar=u.searchParams.get('bar'),interval=({'1H':'1h','4H':'4h','1D':'1d'}[bar]||bar),limit=Number(u.searchParams.get('limit'));
    const rows=responseRows(interval,limit,h.clock,h.down).map(r=>[String(r.openTime),'0',String(r.high),String(r.low),String(r.close)]).reverse();
    return{ok:true,json:async()=>({code:'0',data:rows})};
  };
  // Execute production transport, candle filtering, analytics and syncIntel wrapper.
  // Only I/O, time, observers and the state container are fakes; no real endpoints.
  const load=new Function('createMarketRefreshController','state','num','getJson','fetchTimed','trackedMarketSymbols','notifyData','renderHeaderTruth','Date',production+'\nreturn{syncIntel,marketKlines,intel,profitLockIntel,closedMarketRows};');
  h.api=load(createMarketRefreshController,state,num,getJson,fetchTimed,()=>h.symbols,()=>h.notifications.push(structuredClone(state)),()=>{},Clock);
  return h;
}
const unavailable=async()=>{throw new Error('synthetic unavailable')};
const evidence=(h,s)=>marketEvidence(h.state.assetIntel[s],h.clock);

test('R131 integration wires the one production controller into all existing refresh entry points',()=>{
  assert.match(source,/^import \{createMarketRefreshController\} from '\.\/market-refresh-state\.mjs\?v=10\.0-r\d+';/m);
  assert.equal((source.match(/createMarketRefreshController\(/g)||[]).length,1);
  assert.match(production,/return await refreshMarketIntel\(\)/);
  assert.doesNotMatch(production,/state\.intel\s*=\s*null|marketRowsTimestamp/);
  assert.equal((source.match(/setInterval\(sync,30000\)/g)||[]).length,1);
  assert.equal((source.match(/setInterval\(\(\)=>syncIntel\(\)/g)||[]).length,1);
  assert.equal((source.match(/document\.addEventListener\('visibilitychange'/g)||[]).length,1);
});
test('R131 integration uses actual production analytics and publishes consistent BTC evidence',async()=>{
  const h=harness();assert.equal(await h.api.syncIntel(),true);assert.equal(h.state.marketSyncStatus,'OK');
  assert.equal(h.state.intel.source,'SYNTHETIC');assert.ok(Number.isFinite(h.state.intel.ema200));
  assert.ok(Number.isFinite(h.state.assetIntel.ETH.macd1h.hist));
  assert.equal(h.state.marketSyncedAt,T);assert.equal(evidence(h,'ETH').fresh,true);
  for(const s of h.notifications)if(s.intel){assert.equal(s.intel.updatedAt,s.marketSyncedAt);assert.ok(s.assetIntel.BTC)}
});
test('R131 integration retains global BTC analysis after gateway and direct fallback failure',async()=>{
  const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.intel);
  h.clock+=1000;h.sourceAt=h.clock;h.faults.set('BTC',unavailable);await h.api.syncIntel();
  assert.deepEqual(h.state.intel,before);assert.equal(h.state.marketSyncedAt,T);
  assert.equal(h.state.marketSyncStatus,'PARTIAL');assert.equal(h.state.assetIntel.ETH.updatedAt,T+1000);
  assert.equal(Object.keys(h.state.assetIntel).length,3);
});
test('R131 integration partial fetch failure retains fresh evidence only until its own expiry',async()=>{
  const h=harness();await h.api.syncIntel();h.faults.set('ETH',unavailable);
  h.clock=T+1000;h.sourceAt=h.clock;await h.api.syncIntel();assert.equal(evidence(h,'ETH').fresh,true);
  h.clock=T+180001;h.sourceAt=h.clock;await h.api.syncIntel();
  assert.equal(evidence(h,'ETH').status,'STALE');assert.equal(evidence(h,'SOL').fresh,true);
  assert.equal(h.state.assetIntel.ETH.updatedAt,T);
});
test('R131 integration repeated failures cannot renew evidence through fallback timestamps',async()=>{
  const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  for(const symbol of ['BTC','ETH','SOL'])h.faults.set(symbol,unavailable);
  for(const delta of [60000,180001]){h.clock=T+delta;await h.api.syncIntel();assert.deepEqual(h.state.lastGoodMarketSnapshot,before)}
  assert.equal(h.state.marketSyncStatus,'ERROR');assert.equal(evidence(h,'BTC').status,'STALE');
});
for(const [name,stamp]of[['absent',undefined],['null',null],['zero',0],['future',T+30001],['old',T-180001]]){
  test('R131 integration rejects '+name+' gateway provenance without manufacturing freshness',async()=>{
    const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.lastGoodMarketSnapshot);
    h.sourceAt=stamp;await h.api.syncIntel();assert.deepEqual(h.state.lastGoodMarketSnapshot,before);
    assert.equal(h.state.marketSyncStatus,'ERROR');assert.equal(h.state.marketSyncedAt,T);
  });
}
test('R131 integration a missing gateway timestamp can recover only through an independent direct response',async()=>{
  const h=harness();h.sourceAt=null;h.direct=true;await h.api.syncIntel();
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(h.state.marketSyncedAt,T);
  assert.equal(h.state.intel.transport,'DIRECT_FALLBACK');assert.equal(h.state.intel.source,'OKX USDT-SWAP');
});
test('R131 integration valid cached gateway timestamps remain the source of age',async()=>{
  const h=harness();h.sourceAt=T-5000;await h.api.syncIntel();
  assert.equal(h.state.marketSyncedAt,T-5000);assert.equal(evidence(h,'BTC').ageMs,5000);
});
test('R131 integration over-age gateway stale fallback is not silently used',async()=>{
  const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.intel);
  h.faults.set('BTC',j=>({...j,cache:'STALE_FALLBACK',ageMs:90001}));await h.api.syncIntel();
  assert.deepEqual(h.state.intel,before);assert.equal(h.state.marketSyncStatus,'PARTIAL');
});
test('R131 integration cold start stays missing until successful evidence arrives',async()=>{
  const h=harness(),d=deferred();h.faults.set('BTC:15m',async j=>{await d.promise;return j});
  const run=h.api.syncIntel();await Promise.resolve();assert.equal(h.state.marketSyncStatus,'RUNNING');
  assert.equal(h.state.intel,null);assert.equal(h.state.marketSyncedAt,null);assert.equal(evidence(h,'BTC').status,'MISSING');
  d.resolve();await run;assert.equal(h.state.marketSyncStatus,'OK');
});
test('R131 integration overlapping wrapper calls share one in-flight transport batch',async()=>{
  const h=harness(),d=deferred();h.faults.set('BTC:15m',async j=>{await d.promise;return j});
  const run=h.api.syncIntel();assert.equal(await h.api.syncIntel(),false);
  assert.equal(h.calls.filter(c=>c.kind==='gateway').length,4);d.resolve();await run;
  assert.equal(h.calls.filter(c=>c.kind==='gateway').length,10);
});
test('R131 integration a successful retry recovers without a new recurring timer',async()=>{
  const h=harness();for(const s of ['BTC','ETH','SOL'])h.faults.set(s,unavailable);
  await h.api.syncIntel();assert.equal(h.state.marketSyncStatus,'ERROR');h.faults.clear();h.clock+=1000;h.sourceAt=h.clock;
  await h.api.syncIntel();assert.equal(h.state.marketSyncStatus,'OK');assert.equal(h.state.marketError,null);
  assert.equal(h.state.marketSyncedAt,T+1000);
});
test('R131 integration actual adverse analytics replace calm accepted evidence',async()=>{
  const h=harness();await h.api.syncIntel();h.down=true;h.clock+=1000;h.sourceAt=h.clock;await h.api.syncIntel();
  assert.equal(h.state.assetIntel.ETH.longAction,'RISK REVIEW');assert.equal(h.state.assetIntel.ETH.updatedAt,T+1000);
  h.faults.set('ETH',unavailable);await h.api.syncIntel();assert.equal(h.state.assetIntel.ETH.longAction,'RISK REVIEW');
});
test('R131 integration malformed transport candles cannot replace accepted data',async()=>{
  const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.intel);
  h.faults.set('BTC:4h',j=>({...j,rows:j.rows.map(r=>({...r,high:r.low-1}))}));await h.api.syncIntel();
  assert.deepEqual(h.state.intel,before);assert.match(h.state.marketError,/INVALID_BARS/);
});
test('R131 integration removes untracked ghost evidence without erasing a tracked failed asset',async()=>{
  const h=harness();await h.api.syncIntel();h.symbols=['BTC','ETH'];h.faults.set('ETH',unavailable);h.clock+=1000;h.sourceAt=h.clock;
  await h.api.syncIntel();assert.deepEqual(Object.keys(h.state.assetIntel).sort(),['BTC','ETH']);
  assert.equal(h.state.assetIntel.ETH.updatedAt,T);assert.equal(h.state.lastGoodMarketSnapshot.assetIntel.SOL,undefined);
});
function pairReader(h){
  const from=source.indexOf('function assetPairRisk(symbol){'),to=source.indexOf('\nfunction riskCockpitV2',from);
  assert.ok(from>=0&&to>from);
  const load=new Function('state','botFeedFresh','liveMatched','exposureIntegrity','liveInvestUsdAvailable','num','risk','actionForSide','marketIntelFresh',source.slice(from,to)+'\nreturn assetPairRisk;');
  return load(h.state,()=>true,()=>true,()=>({unknown:0,complete:true}),()=>true,num,b=>b.buffer,(i,side)=>i?.[side==='SHORT'?'shortAction':'longAction']||'SYNC',i=>marketEvidence(i,h.clock).fresh);
}
test('R131 integration retained BTC and asset analyses cannot influence risk after expiry',()=>{
  const h=harness();h.state.bots=[{symbol:'ETH',side:'LONG',investUsd:100,leverage:1,buffer:8}];
  h.state.intel={updatedAt:T,price:90,ema20:100};
  h.state.assetIntel.ETH={updatedAt:T,longAction:'RISK REVIEW',shortAction:'HOLD'};
  const read=pairReader(h);h.clock=T+180000;const fresh=read('ETH');
  assert.ok(fresh.reasons.includes('BTC < EMA20'));assert.ok(fresh.reasons.includes('Struktur/Momentum'));
  h.clock+=1;const expired=read('ETH');assert.deepEqual(expired.reasons,['Liq <10%']);
  assert.equal(expired.profitAction,'SYNC');assert.equal(expired.tone,'danger','fresh bot risk must remain visible');
});
test('R131 integration retained expired global evidence is not rendered as a live BTC setup',()=>{
  const from=source.indexOf('function market(){'),to=source.indexOf('\n',from);
  const text=source.slice(from,to);
  const h=harness();h.state.intel={updatedAt:T,price:100};h.clock=T+180001;
  const render=new Function('state','marketIntelFresh','money',text+'\nreturn market;')(h.state,i=>marketEvidence(i,h.clock).fresh,()=>{throw new Error('expired value formatted')});
  assert.match(render(),/Market sync/);
  assert.match(source,/marketIntelFresh\(state\.intel\)\?state\.intel\.score/);
});


// Claude watchdog finding 6034412015: recent fetch metadata is not candle recency.
for(const interval of ['15m','1h','4h','1d']) {
  test('R131 integration rejects old '+interval+' candles even with a fresh gateway timestamp',async()=>{
    const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.intel);
    h.clock+=1000;h.sourceAt=h.clock;
    h.faults.set('BTC:'+interval,j=>({...j,rows:j.rows.map(r=>({
      ...r,openTime:r.openTime-SPAN[interval]-181001,closeTime:r.closeTime-SPAN[interval]-181001
    }))}));
    await h.api.syncIntel();
    assert.deepEqual(h.state.intel,before);assert.equal(h.state.marketSyncedAt,T);
    assert.match(h.state.marketError,/BTC STALE_CONFIRMATION_BARS/);
    assert.equal(h.state.marketSyncStatus,'PARTIAL');assert.equal(evidence(h,'ETH').fresh,true);
  });
}
test('R131 integration accepts a normally settled previous bar at an interval boundary',async()=>{
  const h=harness();await h.api.syncIntel();
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(h.state.marketSyncedAt,T);
});
test('R131 integration detects stale confirmation candles from a direct fallback too',async()=>{
  const h=harness();h.direct=true;h.sourceAt=null;
  // Production transport is exercised directly; alter its provider rows, not the controller.
  const raw=h.api.marketKlines;
  const state={intel:null,assetIntel:{},marketSyncedAt:null};
  const refresh=createMarketRefreshController({state,trackedMarketSymbols:()=>['BTC'],
    marketKlines:async(interval,limit,symbol)=>{
      const rows=await raw(interval,limit,symbol);
      for(const r of rows){r.openTime-=SPAN[interval]+181001;r.closeTime-=SPAN[interval]+181001}
      return rows;
    },closedMarketRows:h.api.closedMarketRows,intel:h.api.intel,profitLockIntel:h.api.profitLockIntel,
    marketTransportLabel:()=> 'DIRECT_FALLBACK',syncCrossPrices:async()=>{},
    notifyData:()=>{},renderHeaderTruth:()=>{},now:()=>h.clock});
  await refresh();assert.equal(state.intel,null);assert.match(state.marketError,/STALE_CONFIRMATION_BARS/);
});
test('R131 integration unordered candle timestamps cannot reach accepted analytics',async()=>{
  const h=harness();await h.api.syncIntel();const before=structuredClone(h.state.intel);
  h.faults.set('BTC:4h',j=>({...j,rows:[...j.rows].reverse()}));await h.api.syncIntel();
  assert.deepEqual(h.state.intel,before);assert.match(h.state.marketError,/INVALID_BAR_TIMESTAMPS/);
});
test('R131 integration the actual manual refresh path does not classify an in-flight no-op as error',async()=>{
  const h=harness(),d=deferred();h.faults.set('BTC:15m',async j=>{await d.promise;return j});
  const from=source.indexOf('async function refreshNow(){'),to=source.indexOf("\ngo('command');",from);
  assert.ok(from>=0&&to>from);
  let botRefreshes=0,extraNotifications=0;
  const manual=new Function('sync','syncIntel','notifyData',source.slice(from,to)+'\nreturn refreshNow;')(
    async()=>{botRefreshes++;return true},h.api.syncIntel,()=>{extraNotifications++});
  const first=h.api.syncIntel();await manual();
  assert.equal(botRefreshes,1);assert.equal(h.state.marketSyncStatus,'RUNNING');
  assert.equal(h.state.marketError??null,null);assert.equal(extraNotifications,0);
  assert.equal(h.calls.filter(c=>c.kind==='gateway').length,4);
  d.resolve();await first;assert.equal(h.state.marketSyncStatus,'OK');
});

for(const [extra,accepted] of [[180999,true],[181000,false]]) {
  test('R131 integration confirmation-age boundary '+(accepted?'is inclusive':'rejects the next millisecond'),async()=>{
    const h=harness();
    h.faults.set('BTC:4h',j=>({...j,rows:j.rows.map(r=>({
      ...r,openTime:r.openTime-SPAN['4h']-extra,closeTime:r.closeTime-SPAN['4h']-extra
    }))}));
    await h.api.syncIntel();assert.equal(!!h.state.intel,accepted);
    if(!accepted)assert.match(h.state.marketError,/STALE_CONFIRMATION_BARS/);
  });
}
