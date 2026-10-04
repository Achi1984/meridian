import test from 'node:test';
import assert from 'node:assert/strict';
import {runEdgeV1Discovery,chronologicalWindows,profitFactorFromPnls,EDGE_V1_INITIAL_EQUITY} from '../research/paper-edge-v1-discovery-runner.js';

const STEP=4*60*60*1000,START=Date.parse('2021-01-01T00:00:00.000Z');
function sourcePackage({mutateFuture=false}={}){
 const barsBySymbol={},fundingBySymbol={},fundingComplete={};
 for(const [si,s] of ['BTCUSDT','ETHUSDT','SOLUSDT'].entries()){
  barsBySymbol[s]=Array.from({length:20},(_,i)=>{
   const base=100+si*10+i;
   const future=mutateFuture&&i>=12?base*7:base;
   return {openTime:START+i*STEP,closeTime:START+(i+1)*STEP-1,open:future,high:future+2,low:future-2,close:future+1,volume:1000+i};
  });
  fundingBySymbol[s]=[{time:START+2,rate:0.0001,markPrice:null,rateType:null}];
  fundingComplete[s]=true;
 }
 return {
  schema:'PAPER-EDGE-V1-SOURCE-PACKAGE-1',
  researchOnly:true,
  executionImpact:false,
  provenance:{provider:'TEST',paginationComplete:true,fundingComplete},
  barsBySymbol,
  fundingBySymbol
 };
}

test('discovery runner is locked to normalized initial equity',()=>{
 assert.throws(()=>runEdgeV1Discovery(sourcePackage(),{initialEquity:99999}),/INITIAL_EQUITY_LOCKED/);
 assert.equal(EDGE_V1_INITIAL_EQUITY,100000);
});

test('discovery runner evaluates only the frozen 60 percent slice',()=>{
 const r=runEdgeV1Discovery(sourcePackage());
 assert.equal(r.authorizedStage,'DISCOVERY');
 assert.equal(r.split.total,20);
 assert.equal(r.split.discovery.count,12);
 assert.equal(r.equityCurve.length,12);
 assert.equal(r.isolation.maxBarOpenTime,r.split.discovery.to);
 assert.equal(r.isolation.validationValuesRead,false);
 assert.equal(r.isolation.holdoutValuesRead,false);
 assert.equal(r.summary.closedTrades,0);
 assert.equal(r.decision.decision,'EDGE_V1_DISCOVERY_FAIL');
});

test('validation and holdout price values cannot change discovery PnL result',()=>{
 const a=runEdgeV1Discovery(sourcePackage());
 const b=runEdgeV1Discovery(sourcePackage({mutateFuture:true}));
 assert.deepEqual(a.summary,b.summary);
 assert.deepEqual(a.decision,b.decision);
 assert.notEqual(a.sourceDigest,b.sourceDigest);
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
