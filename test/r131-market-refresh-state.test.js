import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMarketRefreshController, marketEvidence,
  MARKET_MAX_AGE_MS, MARKET_FUTURE_TOLERANCE_MS
} from '../v9/market-refresh-state.mjs';

const T = Date.UTC(2026,9,7,8,0,0);
const defer = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const globalValue = (price=100) => ({price, score:50, status:'WAIT FOR RETRACE', source:'SYNTHETIC'});
const assetValue = (price=100) => ({price, longAction:'HOLD', shortAction:'HOLD', longReasons:[], shortReasons:[]});
function bars(limit, clock, price=100) {
  const rows = Array.from({length:limit},(_,i)=>({
    openTime:clock-(limit-i+1)*60000, closeTime:clock-(limit-i)*60000,
    high:price+1, low:price-1, close:price
  }));
  rows.fetchedAt=clock; rows.source='SYNTHETIC'; rows.transport='TEST_ONLY';
  return rows;
}
function harness(symbols=['BTC','ETH','SOL']) {
  const state={intel:null,assetIntel:{},marketSyncedAt:null,marketSyncStatus:'IDLE',
    marketTransport:null,marketError:null,lastGoodMarketSnapshot:null};
  const h={state,clock:T,symbols,calls:[],notifications:[],pauses:[],faults:new Map(),
    buildGlobal:globalValue,buildAsset:assetValue,crossError:false,notifyError:false,headerError:false};
  h.refresh=createMarketRefreshController({state,
    trackedMarketSymbols:()=>h.symbols,
    marketKlines:async(interval,limit,symbol)=>{
      h.calls.push({interval,limit,symbol});
      const change=h.faults.get(symbol+':'+interval)||h.faults.get(symbol);
      const b=bars(limit,h.clock);
      return change ? await change(b,interval) : b;
    },
    closedMarketRows:rows=>rows.filter(x=>x.closeTime<h.clock-1000),
    intel:rows=>h.buildGlobal(rows.at(-1).close),
    profitLockIntel:rows=>h.buildAsset(rows.at(-1).close),
    marketTransportLabel:()=> 'TEST_ONLY',
    syncCrossPrices:async()=>{if(h.crossError)throw new Error('synthetic cross failure');},
    notifyData:()=>{h.notifications.push(structuredClone(state));if(h.notifyError)throw new Error('observer');},
    renderHeaderTruth:()=>{if(h.headerError)throw new Error('header');},
    now:()=>h.clock,
    pause:async ms=>{h.pauses.push(ms);}
  });
  return h;
}
const unavailable=async()=>{throw new Error('synthetic endpoint unavailable');};
const evidence= (h,symbol) => marketEvidence(h.state.assetIntel[symbol],h.clock);

for (const [name,snapshot,offset,expected] of [
  ['no snapshot is unknown',null,0,'MISSING'],
  ['missing timestamp is invalid',{},0,'INVALID'],
  ['null timestamp is invalid',{updatedAt:null},0,'INVALID'],
  ['string timestamp is invalid',{updatedAt:String(T)},0,'INVALID'],
  ['NaN timestamp is invalid',{updatedAt:NaN},0,'INVALID'],
  ['zero timestamp is invalid',{updatedAt:0},0,'INVALID'],
  ['last millisecond inside freshness',{updatedAt:T},MARKET_MAX_AGE_MS-1,'FRESH'],
  ['exact freshness boundary',{updatedAt:T},MARKET_MAX_AGE_MS,'FRESH'],
  ['first millisecond outside freshness',{updatedAt:T},MARKET_MAX_AGE_MS+1,'STALE'],
  ['permitted clock skew',{updatedAt:T+MARKET_FUTURE_TOLERANCE_MS},0,'FRESH'],
  ['future timestamp beyond skew',{updatedAt:T+MARKET_FUTURE_TOLERANCE_MS+1},0,'INVALID']
]) test('R131 evidence: '+name,()=>{
  const result=marketEvidence(snapshot,T+offset);
  assert.equal(result.status,expected);
  assert.equal(result.fresh,expected==='FRESH');
});

test('R131 evidence rejects an invalid captured clock',()=>{
  for(const now of [NaN,null,0,-1,'now'])assert.throws(()=>marketEvidence(null,now),/INVALID_CLOCK/);
});
test('R131 constructor rejects absent dependencies',()=>{
  assert.throws(()=>createMarketRefreshController({state:{}}),/INVALID_DEPENDENCY/);
});
test('R131 cold start exposes no invented evidence while its first fetch is pending',async()=>{
  const h=harness(['BTC']); const d=defer();h.faults.set('BTC:15m',async b=>{await d.promise;return b;});
  const running=h.refresh(); await Promise.resolve();
  assert.equal(h.state.marketSyncStatus,'RUNNING');assert.equal(h.state.intel,null);
  assert.equal(h.state.marketSyncedAt,null);assert.equal(evidence(h,'BTC').status,'MISSING');
  d.resolve();assert.equal(await running,true);assert.equal(h.state.marketSyncStatus,'OK');
});
test('R131 BTC data and source timestamp publish together before any notification',async()=>{
  const h=harness();await h.refresh();
  for(const s of h.notifications){
    if(s.assetIntel.BTC){assert.ok(s.intel);assert.equal(s.marketSyncedAt,s.intel.updatedAt);}
    else {assert.equal(s.intel,null);assert.equal(s.marketSyncedAt,null);}
  }
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(h.state.marketSyncedAt,T);
  assert.deepEqual(h.state.marketRefreshAccepted,['BTC','ETH','SOL']);
});
test('R131 BTC has independently timestamped global and directional evidence',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC:1d',b=>{b.fetchedAt=T-5000;return b;});await h.refresh();
  assert.equal(h.state.intel.updatedAt,T-5000);assert.equal(h.state.marketSyncedAt,T-5000);
  assert.equal(h.state.assetIntel.BTC.updatedAt,T);
});
test('R131 valid last-good values stay unchanged while a refresh is in flight',async()=>{
  const h=harness();await h.refresh();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  h.clock+=1000;const d=defer();h.faults.set('BTC:15m',async b=>{await d.promise;return b;});
  const running=h.refresh();await Promise.resolve();
  assert.deepEqual(h.state.lastGoodMarketSnapshot,before);assert.equal(evidence(h,'BTC').ageMs,1000);
  assert.equal(h.state.marketSyncStatus,'RUNNING');d.resolve();await running;
});
test('R131 BTC failure preserves accepted global data and does not zero the asset map',async()=>{
  const h=harness();await h.refresh();const global=h.state.intel,btc=h.state.assetIntel.BTC;
  h.clock+=1000;h.faults.set('BTC',unavailable);await h.refresh();
  assert.strictEqual(h.state.intel,global);assert.strictEqual(h.state.assetIntel.BTC,btc);
  assert.equal(h.state.marketSyncedAt,T);assert.equal(h.state.assetIntel.ETH.updatedAt,T+1000);
  assert.equal(h.state.marketSyncStatus,'PARTIAL');assert.equal(evidence(h,'BTC').fresh,true);
});
test('R131 repeated total failure cannot refresh any accepted timestamp',async()=>{
  const h=harness();await h.refresh();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  for(const s of h.symbols)h.faults.set(s,unavailable);
  for(const delta of [60000,120000,180001]){
    h.clock=T+delta;await h.refresh();assert.deepEqual(h.state.lastGoodMarketSnapshot,before);
    assert.equal(h.state.marketSyncedAt,T);assert.equal(h.state.marketSyncStatus,'ERROR');
  }
  assert.equal(evidence(h,'BTC').status,'STALE');
  assert.equal(evidence(h,'ETH').updatedAt,T);assert.equal(h.state.marketSyncCompletedAt,T+180001);
});
test('R131 failed cold start remains missing, distinct from expired evidence',async()=>{
  const h=harness();for(const s of h.symbols)h.faults.set(s,unavailable);await h.refresh();
  assert.equal(h.state.intel,null);assert.deepEqual(h.state.assetIntel,{});
  assert.equal(h.state.lastGoodMarketSnapshot,null);assert.equal(evidence(h,'BTC').status,'MISSING');
  assert.equal(h.state.marketSyncStatus,'ERROR');
});
test('R131 15-asset partial failure updates eight and retains seven still-fresh values',async()=>{
  const symbols=['BTC',...Array.from({length:14},(_,i)=>'A'+i)],h=harness(symbols);await h.refresh();
  const failed=symbols.slice(0,7);failed.forEach(s=>h.faults.set(s,unavailable));h.clock+=1000;await h.refresh();
  assert.equal(h.state.marketSyncStatus,'PARTIAL');assert.equal(h.state.marketRefreshAccepted.length,8);
  assert.equal(Object.keys(h.state.assetIntel).length,15);
  assert.equal(symbols.filter(s=>evidence(h,s).fresh).length,15);
  failed.forEach(s=>assert.equal(h.state.assetIntel[s].updatedAt,T));
});
test('R131 partial refresh after expiry leaves only the successfully updated assets fresh',async()=>{
  const symbols=['BTC',...Array.from({length:14},(_,i)=>'A'+i)],h=harness(symbols);await h.refresh();
  symbols.slice(0,7).forEach(s=>h.faults.set(s,unavailable));h.clock+=MARKET_MAX_AGE_MS+1;await h.refresh();
  assert.equal(symbols.filter(s=>evidence(h,s).fresh).length,8);
  assert.equal(symbols.filter(s=>evidence(h,s).status==='STALE').length,7);
  assert.equal(h.state.marketSyncedAt,T);
});

for(const [name,change,code] of [
  ['missing',b=>{delete b.fetchedAt;return b;},'MISSING_SOURCE_TIMESTAMP'],
  ['null',b=>{b.fetchedAt=null;return b;},'MISSING_SOURCE_TIMESTAMP'],
  ['future',b=>{b.fetchedAt=T+30001;return b;},'FUTURE_SOURCE_TIMESTAMP'],
  ['expired',b=>{b.fetchedAt=T-MARKET_MAX_AGE_MS-1;return b;},'STALE_SOURCE_TIMESTAMP'],
  ['older',b=>{b.fetchedAt=T-1;return b;},'OLDER_THAN_ACCEPTED']
])test('R131 rejects '+name+' source timestamp without replacing good BTC data',async()=>{
  const h=harness(['BTC']);await h.refresh();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  h.faults.set('BTC:4h',change);await h.refresh();
  assert.deepEqual(h.state.lastGoodMarketSnapshot,before);assert.match(h.state.marketError,new RegExp(code));
});
test('R131 every interval is validated; a future daily source cannot be hidden by a valid minimum',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC:1d',b=>{b.fetchedAt=T+30001;return b;});await h.refresh();
  assert.equal(h.state.intel,null);assert.equal(h.state.assetIntel.BTC,undefined);
});
test('R131 missing per-asset timestamp preserves that asset while other successes publish',async()=>{
  const h=harness();await h.refresh();h.clock+=1000;
  h.faults.set('ETH:1h',b=>{delete b.fetchedAt;return b;});await h.refresh();
  assert.equal(h.state.assetIntel.ETH.updatedAt,T);assert.equal(h.state.assetIntel.SOL.updatedAt,T+1000);
});
test('R131 invalid global analysis cannot partially replace the BTC directional tuple',async()=>{
  const h=harness(['BTC']);await h.refresh();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  h.clock+=1000;h.buildGlobal=()=>({price:NaN});await h.refresh();
  assert.deepEqual(h.state.lastGoodMarketSnapshot,before);assert.match(h.state.marketError,/INVALID_ANALYSIS/);
});
test('R131 invalid directional actions cannot become accepted evidence',async()=>{
  const h=harness(['BTC']);h.buildAsset=()=>({price:100,longAction:'BUY_NOW',shortAction:'HOLD'});await h.refresh();
  assert.equal(h.state.assetIntel.BTC,undefined);assert.match(h.state.marketError,/INVALID_ACTIONS/);
});
test('R131 malformed candles fail closed before analysis publication',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC:4h',b=>{b[0].high=NaN;return b;});await h.refresh();
  assert.equal(h.state.intel,null);assert.match(h.state.marketError,/INVALID_BARS/);
});
test('R131 insufficient closed confirmation bars fail closed',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC:1d',b=>{b.forEach(x=>{x.closeTime=T+1;});return b;});await h.refresh();
  assert.equal(h.state.intel,null);assert.match(h.state.marketError,/INSUFFICIENT_BARS/);
});
test('R131 newly verified adverse analysis publishes while another asset is still pending',async()=>{
  const h=harness();await h.refresh();h.clock+=1000;
  const d=defer();h.faults.set('SOL:15m',async b=>{await d.promise;return b;});
  h.buildAsset=price=>({...assetValue(price),longAction:'RISK REVIEW',longReasons:['synthetic adverse reading']});
  const running=h.refresh();
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(h.state.assetIntel.BTC.longAction,'RISK REVIEW');
  assert.equal(h.state.assetIntel.ETH.longAction,'RISK REVIEW');
  assert.equal(h.state.marketSyncStatus,'RUNNING');d.resolve();await running;
  h.faults.set('BTC',unavailable);await h.refresh();assert.equal(h.state.assetIntel.BTC.longAction,'RISK REVIEW');
});
test('R131 overlapping refresh requests are single-flight',async()=>{
  const h=harness(['BTC']),d=defer();h.faults.set('BTC:15m',async b=>{await d.promise;return b;});
  const first=h.refresh();assert.equal(await h.refresh(),false);assert.equal(h.calls.length,4);
  d.resolve();await first;assert.equal(await h.refresh(),true);assert.equal(h.calls.length,8);
});
test('R131 failure followed by retry recovers without stacked work or fake timestamps',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC',unavailable);await h.refresh();await h.refresh();
  h.faults.clear();h.clock+=1000;await h.refresh();
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(h.state.marketError,null);
  assert.equal(h.state.marketSyncedAt,T+1000);assert.equal(h.calls.length,12);
});
test('R131 cross-price rejection does not destroy a valid market analysis',async()=>{
  const h=harness();h.crossError=true;await h.refresh();
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(evidence(h,'BTC').fresh,true);
  assert.equal(h.state.marketPriceError,'CROSS_PRICE_REFRESH_FAILED');
});
test('R131 repeated symbols do not duplicate fetches and BTC is requested once',async()=>{
  const h=harness(['ETH','BTC','ETH','BTC']);await h.refresh();
  assert.equal(h.calls.filter(x=>x.symbol==='BTC').length,4);
  assert.equal(h.calls.filter(x=>x.symbol==='ETH').length,3);
});
test('R131 invalid universe aborts without touching accepted data and permits retry',async()=>{
  const h=harness();await h.refresh();const before=structuredClone(h.state.lastGoodMarketSnapshot);
  h.symbols=['BTC','../private'];assert.equal(await h.refresh(),false);
  assert.deepEqual(h.state.lastGoodMarketSnapshot,before);assert.equal(h.state.marketSyncStatus,'ERROR');
  h.symbols=['BTC'];assert.equal(await h.refresh(),true);
});
test('R131 preserves existing four-asset batching delay and creates no recurring timer',async()=>{
  const h=harness(['BTC','A1','A2','A3','A4','A5','A6','A7','A8','A9']);await h.refresh();
  assert.deepEqual(h.pauses,[220,220]);
  const source=readFileSync(new URL('../v9/market-refresh-state.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/setInterval\s*\(|addEventListener\s*\(/);
});
test('R131 builder references cannot mutate the accepted nested evidence later',async()=>{
  const h=harness(['BTC']),builder=assetValue();h.buildAsset=()=>builder;await h.refresh();
  builder.longReasons.push('later');assert.deepEqual(h.state.assetIntel.BTC.longReasons,[]);
});
test('R131 observer failure does not strand the single-flight lock or invalidate data',async()=>{
  const h=harness(['BTC']);h.notifyError=true;h.headerError=true;await h.refresh();
  assert.equal(h.state.marketSyncStatus,'OK');assert.equal(await h.refresh(),true);
  assert.equal(evidence(h,'BTC').fresh,true);assert.ok(h.state.marketRefreshObserverError);
});
test('R131 no private storage or review/execution authorization is introduced',()=>{
  const source=readFileSync(new URL('../v9/market-refresh-state.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB)\b|Authorized\s*[:=]\s*true/);
  assert.equal(MARKET_MAX_AGE_MS,180000);assert.equal(MARKET_FUTURE_TOLERANCE_MS,30000);
});


test('R131 arbitrary uppercase transport errors are not leaked as diagnostic codes',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC',async()=>{throw new Error('PRIVATESECRETVALUE');});await h.refresh();
  assert.equal(h.state.marketError,'BTC FETCH_OR_ANALYSIS_FAILED');
});
test('R131 no-evidence age remains unknown and does not use the last refresh-attempt time',async()=>{
  const h=harness(['BTC']);h.faults.set('BTC',unavailable);h.clock=T+120000;await h.refresh();
  assert.equal(h.state.marketSyncCompletedAt,T+120000);
  assert.deepEqual(evidence(h,'BTC'),{status:'MISSING',ageMs:null,updatedAt:null,fresh:false});
});
