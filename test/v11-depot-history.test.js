import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDepotHistoryModel} from '../v11/depot-history-model.js';
const now=Date.parse('2026-10-13T20:00:00Z');
const point=(timestamp,totalUsd=150)=>({timestamp,totalUsd,spotUsd:totalUsd,tradingUsd:0,sourceStatus:{spot:'STRICT_AUTHORITY',trading:'PIONEX_EQUITY',tradingFresh:true,tradingAuthorityVersion:'PIONEX_FRESH_V1',tradingSource:'PIONEX_WALLET_READ_API',tradingUpdatedAt:timestamp}});
const raw=points=>({version:'7.64-CANONICAL-PORTFOLIO-HISTORY-V3',source:'POSTGRES_CANONICAL_HISTORY',points,rawPointCount:points.length,excludedIncompletePoints:0});
test('history windows use real recorded points, not a current-value endpoint',()=>{
 const s=raw([point(now-3*86400000),point(now-3*3600000),point(now-600000),point(now-300000,0)]);
 assert.equal(buildDepotHistoryModel(s,{now,range:'1h'}).points.length,2);
 assert.equal(buildDepotHistoryModel(s,{now,range:'1d'}).points.length,3);
 const m=buildDepotHistoryModel(s,{now,range:'1w'});assert.equal(m.points.length,4);assert.equal(m.segments.length,3);assert.equal(m.points.at(-1).totalUsd,0);
 assert.equal(m.points.at(-1).timestamp,now-300000);assert.equal(m.end,now);
});
test('empty history and one genuine point never fabricate a curve',()=>{
 assert.equal(buildDepotHistoryModel(raw([]),{now}).status,'empty');
 const m=buildDepotHistoryModel(raw([point(now-1000)]),{now});assert.equal(m.points.length,1);assert.equal(m.segments[0].length,1);
});
test('unknown gaps never get joined; future, malformed, reordered points fail closed',()=>{
 const s=raw([point(now-2000),point(now-1000)]);s.excludedIncompletePoints=1;s.rawPointCount=3;
 assert.equal(buildDepotHistoryModel(s,{now}).segments.length,2);
 for(const points of [[point(now+1)],[point(now-1),point(now-2)],[{...point(now-1),totalUsd:null}],[{...point(now-1),sourceStatus:{}}]]){
  const m=buildDepotHistoryModel(raw(points),{now});assert.equal(m.status,'unavailable');assert.deepEqual(m.points,[]);
 }
});

test('history accepts valid timezone provenance without normalizing impossible dates',()=>{
 const p=point(now-1000);p.sourceStatus.tradingUpdatedAt='2026-10-13T21:59:59+02:00';
 assert.equal(buildDepotHistoryModel(raw([p]),{now}).status,'ready');
 p.sourceStatus.tradingUpdatedAt='2026-02-30T21:59:59+02:00';assert.equal(buildDepotHistoryModel(raw([p]),{now}).status,'unavailable');
});
