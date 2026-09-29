import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET,
  ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS,
  runAdaptiveTrendSharpeProxyV1
} from '../research/adaptive-trend-sharpe-proxy-v1.js';

const H=3600000,BAR=6*H,DAY=24*H;

function makeBars(start,end,price=100,phase=0){
  const out=[];let p=price,i=0;
  for(let t=start;t<end;t+=BAR,i++){
    const block=Math.floor((i+phase)/(45*4))%2===0?1:-1;
    const r=block*.0022+Math.sin((i+phase)/13)*.0006;
    const o=p,c=Math.max(.01,p*(1+r)),wiggle=.0025+Math.abs(r);
    out.push({openTime:t,closeTime:t+BAR-1,open:o,high:Math.max(o,c)*(1+wiggle),low:Math.min(o,c)*(1-wiggle),close:c,volume:1e6+i});
    p=c;
  }
  return out;
}
function makeFunding(start,end,rate=.00001){
  const out=[];
  for(let t=start-8*H;t<=end+8*H;t+=8*H)out.push({fundingTime:t,fundingRate:rate});
  return out;
}
function data(){
  const start=Date.UTC(2021,9,1),end=Date.UTC(2023,9,1),d={};
  d.BTC={bars:makeBars(start,end,40000,0),funding:makeFunding(start,end)};
  ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS.forEach((a,i)=>d[a]={
    bars:makeBars(start,end,80+i*7,i*17),
    funding:makeFunding(start,end,.00001+(i%3)*.000002)
  });
  return d;
}
const cfg={
  evalStart:Date.UTC(2022,0,1),
  evalEnd:Date.UTC(2023,8,1),
  gate:{minPeriods:100,minProfitFactor:0,maxDrawdownPct:100,minSharpe:-99,minPositiveWindows:0,minPositiveAssets:0,maxPositivePnlConcentrationPct:100}
};

test('proxy is isolated research-only on the frozen disjoint universe',()=>{
  const r=runAdaptiveTrendSharpeProxyV1(data(),cfg);
  assert.equal(r.ruleset,ADAPTIVE_TREND_SHARPE_PROXY_V1_RULESET);
  assert.equal(r.exactReplication,false);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.deepEqual(r.assets,[...ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS]);
  assert.equal(r.assets.some(x=>['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'].includes(x)),false);
});

test('stress cost cannot improve identical replay',()=>{
  const r=runAdaptiveTrendSharpeProxyV1(data(),cfg);
  assert.ok(r.stressSummary.totalReturnPct<=r.summary.totalReturnPct+1e-12);
  assert.ok(r.diagnostics.totalStressCostPct>=r.diagnostics.totalModeledCostPct);
});

test('portfolio remains unlevered with gross exposure at or below 100%',()=>{
  const r=runAdaptiveTrendSharpeProxyV1(data(),cfg);
  assert.ok(r.periods.length>100);
  for(const p of r.periods)assert.ok(p.grossExposure<=1+1e-12);
});

test('future data cannot change already-computed monthly selectors',()=>{
  const d1=data(),d2=structuredClone(d1),cut=Date.UTC(2023,0,1);
  for(const a of ADAPTIVE_TREND_SHARPE_PROXY_V1_ASSETS)for(const b of d2[a].bars)if(b.openTime>=cut){
    b.close*=1.5;b.high=Math.max(b.high,b.close);b.low=Math.min(b.low,b.close);
  }
  const a=runAdaptiveTrendSharpeProxyV1(d1,cfg),b=runAdaptiveTrendSharpeProxyV1(d2,cfg);
  const old=x=>x.selection.filter(s=>s.sampleEnd<cut).map(s=>({month:s.month,long:s.long,short:s.short}));
  assert.deepEqual(old(a),old(b));
});

test('missing funding fails closed for affected intervals',()=>{
  const d=data(),cut=Date.UTC(2022,6,1);
  d.DOGE.funding=d.DOGE.funding.filter(x=>x.fundingTime<cut);
  const r=runAdaptiveTrendSharpeProxyV1(d,cfg);
  assert.ok(r.diagnostics.unavailableIntervals.DOGE>0);
  assert.equal(Number.isFinite(r.summary.totalReturnPct),true);
});
