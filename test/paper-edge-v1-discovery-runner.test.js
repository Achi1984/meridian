import test from 'node:test';
import assert from 'node:assert/strict';
import {runEdgeV1Discovery,chronologicalWindows,profitFactorFromPnls,fundingEventsForBar,EDGE_V1_INITIAL_EQUITY,EDGE_V1_DISCOVERY_SOURCE_LOCK,EDGE_V1_DISCOVERY_SPLIT_LOCK} from '../research/paper-edge-v1-discovery-runner.js';

const STEP=4*60*60*1000,START=Date.parse('2021-01-01T00:00:00.000Z');
function syntheticSource(){
 const barsBySymbol={},fundingBySymbol={},fundingComplete={};
 for(const [si,s] of ['BTCUSDT','ETHUSDT','SOLUSDT'].entries()){
  barsBySymbol[s]=Array.from({length:20},(_,i)=>{const base=100+si*10+i;return{openTime:START+i*STEP,closeTime:START+(i+1)*STEP-1,open:base,high:base+2,low:base-2,close:base+1,volume:1000+i}});
  fundingBySymbol[s]=[{time:START+2,rate:.0001,markPrice:null,rateType:null}];
  fundingComplete[s]=true;
 }
 return{schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',researchOnly:true,executionImpact:false,provenance:{provider:'TEST',paginationComplete:true,fundingComplete},barsBySymbol,fundingBySymbol};
}

test('discovery runner is locked to normalized initial equity',()=>{
 assert.throws(()=>runEdgeV1Discovery(syntheticSource(),{initialEquity:99999}),/INITIAL_EQUITY_LOCKED/);
 assert.equal(EDGE_V1_INITIAL_EQUITY,100000);
});

test('Discovery requires the immutable validated source receipt',()=>{
 assert.equal(EDGE_V1_DISCOVERY_SOURCE_LOCK.runId,37231163461);
 assert.equal(EDGE_V1_DISCOVERY_SOURCE_LOCK.receiptDigest,'d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08');
 assert.throws(()=>runEdgeV1Discovery(syntheticSource()),/SOURCE_DIGEST_MISMATCH/);
});

test('Discovery split boundaries are frozen independently of result values',()=>{
 assert.deepEqual(EDGE_V1_DISCOVERY_SPLIT_LOCK,{total:12594,discovery:{from:1609459200000,to:1718251200000,count:7556},validation:{from:1718265600000,count:2519},holdout:{from:1754539200000,count:2519}});
});

test('five chronological windows are contiguous and near equal count',()=>{
 const xs=Array.from({length:17},(_,i)=>START+i*STEP),w=chronologicalWindows(xs,5);
 assert.equal(w.length,5);
 assert.equal(w.reduce((a,x)=>a+x.count,0),17);
 assert.equal(w[0].from,xs[0]);
 assert.equal(w.at(-1).to,xs.at(-1));
 assert.ok(Math.max(...w.map(x=>x.count))-Math.min(...w.map(x=>x.count))<=1);
});

test('profit factor uses closed-trade net PnL',()=>{
 assert.equal(profitFactorFromPnls([10,-5,5]),3);
 assert.equal(profitFactorFromPnls([0,0]),0);
 assert.equal(profitFactorFromPnls([5]),Number.MAX_SAFE_INTEGER);
});

test('funding at the bar-open boundary is included only for a position already open',()=>{
 const bar={openTime:START+STEP,closeTime:START+2*STEP-1};
 const events=[{time:bar.openTime,rate:.0001},{time:bar.openTime+47,rate:.0002},{time:bar.openTime+1001,rate:.00025},{time:bar.closeTime,rate:.0003}];
 assert.equal(fundingEventsForBar(events,START,bar).length,4);
 assert.deepEqual(fundingEventsForBar(events,bar.openTime,bar).map(x=>x.rate),[.00025,.0003]);
});
