import test from 'node:test';
import assert from 'node:assert/strict';
import {pionexHistorySnapshot,appendPionexHistory,readPionexHistory} from '../pionex-history-store.js';
import {buildPionexHistoryModel} from '../v11/pionex-history-model.js';
const now=Date.parse('2026-10-31T12:00:00Z');
const data=(value=123,at=now)=>({pionexAccount:{wallet:{totalInUsdt:value},walletStatus:'OK',updatedAt:new Date(at).toISOString()},pionexAccountSync:{status:'OK'}});
const payload=points=>({version:'PIONEX_HISTORY_V1',source:'POSTGRES_PIONEX_HISTORY',scope:'PIONEX',currency:'USD/USDT',generatedAt:new Date(now).toISOString(),points});
test('fresh Pionex independent of missing aggregate sources; exact zero retained',()=>{
 assert.equal(pionexHistorySnapshot(data(0),now).valueUsd,0);
 assert.equal(pionexHistorySnapshot(data(),now).scope,'PIONEX');
 for(const v of [null,'', ' ',true,false,[],{},-1,Infinity])assert.equal(pionexHistorySnapshot(data(v),now),null,String(v));
 for(const at of [now-900001,now+1])assert.equal(pionexHistorySnapshot(data(1,at),now),null);
 assert.equal(pionexHistorySnapshot(data(7,now-900000),now).valueUsd,7);
 assert.equal(pionexHistorySnapshot({portfolio:{totalUsd:1000,tradingUsd:500}},now),null);
});
test('append rejects unknown without writes and database dedupes by source observation',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:calls.length===1?[{id:1}]:[]};}};
 assert.equal((await appendPionexHistory(db,{}, {timestamp:now})).ok,false);assert.equal(calls.length,0);
 assert.equal((await appendPionexHistory(db,data(),{timestamp:now})).inserted,true);
 assert.equal((await appendPionexHistory(db,data(),{timestamp:now+1000})).inserted,false);
 assert.match(calls[0].sql,/ON CONFLICT\(source_at,source\) DO NOTHING/);
 assert.equal(calls[1].params[1],now);
});
test('read rejects incomplete provenance rather than zero filling',async()=>{
 const p=pionexHistorySnapshot(data(),now);
 const row={captured_at:new Date(now),source_at:new Date(now),value_usd:'123',source:p.source,authority_version:p.authorityVersion};
 const result=await readPionexHistory({query:async()=>({rows:[row,{...row,value_usd:null},{...row,source_at:null}]})},{now});
 assert.equal(result.points.length,1);assert.equal(result.excludedPoints,2);
});
test('history read selects the latest bounded observations by source time and rejects out-of-window sources',async()=>{
 const p=pionexHistorySnapshot(data(),now),start=now-3600000;
 const row={captured_at:new Date(start+1000),source_at:new Date(start),value_usd:'123',source:p.source,authority_version:p.authorityVersion};
 let statement,parameters;
 const result=await readPionexHistory({query:async(sql,args)=>{statement=sql;parameters=args;return {rows:[
   {...row,source_at:new Date(start-1)},row,
   {...row,source_at:new Date(now),captured_at:new Date(now+1)}
 ]};}},{now,rangeMs:3600000});
 assert.deepEqual(parameters,[start,now]);
 assert.match(statement,/WHERE source_at>=/);
 assert.match(statement,/ORDER BY source_at DESC,id DESC LIMIT 2200\s*\) recent ORDER BY source_at ASC,id ASC/);
 assert.equal(result.points.length,1);assert.equal(result.points[0].sourceAt,start);
 assert.equal(result.excludedPoints,2);
});
test('empty/single/constant histories, real source time and gap boundaries',()=>{
 assert.equal(buildPionexHistoryModel(payload([]),{now}).status,'empty');
 const p=at=>pionexHistorySnapshot(data(0,at),at+1000);
 const one=buildPionexHistoryModel(payload([p(now-10000)]),{now});
 assert.equal(one.points[0].timestamp,now-10000);assert.equal(one.points[0].capturedAt,now-9000);assert.equal(one.segments[0].length,1);
 const result=buildPionexHistoryModel(payload([p(now-2000000),p(now-1000000),p(now-999000)]),{now});
 assert.deepEqual(result.segments.map(s=>s.length),[1,2]);assert.equal(result.points[0].totalUsd,0);
});
test('duplicates, excluded records and wrong aggregate envelope cannot manufacture curve',()=>{
 const p=pionexHistorySnapshot(data(),now-30001);
 assert.equal(p,null);
 const point=pionexHistorySnapshot(data(123,now-2000),now-1000);
 assert.equal(buildPionexHistoryModel(payload([point,point]),{now}).points.length,1);
 assert.equal(buildPionexHistoryModel({...payload([point]),source:'POSTGRES_CANONICAL_HISTORY'},{now}).status,'unavailable');
 const points=[{...point,sourceAt:now-4000},{...point,sourceAt:now-2000}];
 assert.deepEqual(buildPionexHistoryModel({...payload(points),excludedPoints:1},{now}).segments.map(s=>s.length),[1,1]);
});

test('runtime records Pionex despite aggregate incompleteness and failed existing price read',async()=>{
 const {capturePortfolioHistoryOnce}=await import('../portfolio-history-runtime.js');
 const writes=[];const db={query:async(sql,params)=>{writes.push(sql);return {rows:/INSERT INTO meridian_pionex_history/.test(sql)?[{id:1}]:[]};}};
 const r=await capturePortfolioHistoryOnce({db,data:data(),now,fetchPrices:async()=>{throw Error('synthetic');}});
 assert.equal(r.ok,false);assert.equal(r.reason,'PORTFOLIO_AUTHORITY_INCOMPLETE');assert.equal(r.pionexHistory.inserted,true);
 assert.equal(writes.filter(sql=>/INSERT INTO meridian_pionex_history/.test(sql)).length,1);
 assert.equal(writes.filter(sql=>/INSERT INTO meridian_portfolio_history/.test(sql)).length,0);
});

test('Pionex client history succeeds independently, never substitutes current valuation, lock erases history',async()=>{
 const {createDepotReadClient}=await import('../v11/depot-read-client.js');
 let token='password',states=[],dashboardFails=false,historyFails=false;
 const point=pionexHistorySnapshot(data(55,now-1000),now);
 const client=createDepotReadClient({pionexOnly:true,getToken:()=>token,now:()=>now,onChange:s=>states.push(s),fetchImpl:async(url)=>{
   const history=url.includes('pionex-history');
   if(history?historyFails:dashboardFails)throw Error('synthetic');
   return new Response(JSON.stringify(history?payload([point]):{private:true,data:{...data(),portfolio:{}}}),{status:200});
 }});
 await client.refresh();assert.equal(states.at(-1).history['1d'].status,'ready');assert.equal(states.at(-1).model.totalUsd,123);
 dashboardFails=true;await client.refresh();assert.equal(states.at(-1).model,null);assert.equal(states.at(-1).history['1d'].status,'ready');
 dashboardFails=false;historyFails=true;await client.refresh();assert.equal(states.at(-1).model.totalUsd,123);assert.equal(states.at(-1).reasons.history,'TRANSPORT');
 token=null;client.revalidate();assert.equal(states.at(-1).history,null);client.dispose();
});
