import test from 'node:test';
import assert from 'node:assert/strict';
import {runCrossVenueFundingSpreadV1} from '../research/cross-venue-funding-spread-v1.js';

const HOUR=3600000;
const ASSETS=['DOGE','XRP','LINK','AVAX'];

function marks(start,end,startPx){
  const out=[];let p=startPx;
  for(let t=start;t<end;t+=8*HOUR){
    const close=p*1.00004;
    out.push({t,T:t+8*HOUR-1,c:String(close)});
    p=close;
  }
  return out;
}
function binanceMarks(start,end,startPx){
  return marks(start,end,startPx).map(x=>[x.t,String(+x.c/1.00004),x.c,x.c,x.c,'0',x.T]);
}
function funding(start,end,stepHours,rate,binance=false){
  const out=[];
  for(let t=start;t<end;t+=stepHours*HOUR)out.push(binance?{fundingTime:t,fundingRate:String(rate)}:{time:t,fundingRate:String(rate)});
  return out;
}
function dataset(){
  const start=Date.UTC(2024,0,1),end=Date.UTC(2025,0,1),px=[.08,.6,14,35];
  return Object.fromEntries(ASSETS.map((asset,i)=>[asset,{
    binanceMarks:binanceMarks(start,end,px[i]),
    hyperliquidMarks:marks(start,end,px[i]*1.0002),
    binanceFunding:funding(start,end,8,.000005,true),
    hyperliquidFunding:funding(start,end,1,.00001,false)
  }]));
}

test('transfer holdout evaluates only the frozen disjoint asset universe',()=>{
  const r=runCrossVenueFundingSpreadV1(dataset(),{
    assets:ASSETS,
    gate:{minAssetMonthCycles:32,minCyclesPerAsset:8}
  });
  assert.deepEqual(r.assets,ASSETS);
  assert.equal(r.byAsset.length,4);
  assert.equal(r.byAsset.every(x=>ASSETS.includes(x.asset)),true);
  assert.equal(r.byAsset.some(x=>['BTC','ETH','SOL'].includes(x.asset)),false);
  assert.ok(r.cycles.length>=32);
});

test('transfer holdout keeps the frozen direction and remains execution-neutral',()=>{
  const r=runCrossVenueFundingSpreadV1(dataset(),{
    assets:ASSETS,
    gate:{minAssetMonthCycles:32,minCyclesPerAsset:8}
  });
  assert.equal(r.direction,'LONG_BINANCE_USDM_PERP_SHORT_HYPERLIQUID_PERP');
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
});
