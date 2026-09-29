import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DYNAMIC_GRID_PROXY_V1_RULESET,
  runDynamicGridMonth,
  summarizeGridCycles,
  evaluateDynamicGridPath,
  evaluateDynamicGridCandidate
} from '../research/dynamic-grid-proxy-v1.js';

const MIN=60000;
function bar(i,{open=100,high=101,low=99,close=100}={}){
  return{openTime:i*MIN,closeTime:(i+1)*MIN-1,open,high,low,close};
}
function oscillatingBars(n=240){
  const out=[];
  let prev=100;
  for(let i=0;i<n;i++){
    const up=i%4<2;
    const close=up?100.8:99.2;
    out.push(bar(i,{open:prev,high:103,low:97,close}));
    prev=close;
  }
  return out;
}
function quietBars(n=240){
  const out=[];let p=100;
  for(let i=0;i<n;i++){
    const next=p*(1+(i%2?-.0006:.0006));
    out.push(bar(i,{open:p,high:Math.max(p,next)*1.001,low:Math.min(p,next)*.999,close:next}));
    p=next;
  }
  return out;
}

test('Dynamic Grid month remains research-only and self-financing',()=>{
  const r=runDynamicGridMonth({bars:oscillatingBars(),stepPct:.01,halfLevels:2,pathMode:'PAPER_OLHC',dynamicReset:true});
  assert.equal(r.ruleset,DYNAMIC_GRID_PROXY_V1_RULESET);
  assert.equal(r.valid,true,r.reason);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.ok(Number.isFinite(r.endEquity));
  assert.ok(r.endEquity>0);
  assert.equal(r.insufficientWallet,false);
});

test('dynamic boundary handling resets only through explicit reset state',()=>{
  const r=runDynamicGridMonth({bars:oscillatingBars(30),stepPct:.01,halfLevels:2,pathMode:'PAPER_OLHC',dynamicReset:true});
  assert.equal(r.valid,true,r.reason);
  assert.ok(r.resets>0);
  assert.ok(r.rebalances===r.resets+1);
  assert.ok(r.fills>0);
});

test('static benchmark never performs dynamic resets',()=>{
  const r=runDynamicGridMonth({bars:oscillatingBars(30),stepPct:.01,halfLevels:2,pathMode:'PAPER_OLHC',dynamicReset:false});
  assert.equal(r.valid,true,r.reason);
  assert.equal(r.resets,0);
  assert.equal(r.rebalances,1);
});

test('higher slippage cannot improve the exact same dynamic replay',()=>{
  const bars=oscillatingBars();
  const low=runDynamicGridMonth({bars,stepPct:.01,halfLevels:3,pathMode:'ALT_OHLC',dynamicReset:true,slippageBps:2});
  const high=runDynamicGridMonth({bars,stepPct:.01,halfLevels:3,pathMode:'ALT_OHLC',dynamicReset:true,slippageBps:20});
  assert.equal(low.valid,true,low.reason);
  assert.equal(high.valid,true,high.reason);
  assert.ok(high.endEquity<=low.endEquity+1e-8);
  assert.ok(high.costs>=low.costs);
});

test('both frozen path modes are accepted and can expose different outcomes',()=>{
  const bars=oscillatingBars(80);
  const p=runDynamicGridMonth({bars,stepPct:.01,halfLevels:2,pathMode:'PAPER_OLHC',dynamicReset:true});
  const a=runDynamicGridMonth({bars,stepPct:.01,halfLevels:2,pathMode:'ALT_OHLC',dynamicReset:true});
  assert.equal(p.valid,true,p.reason);
  assert.equal(a.valid,true,a.reason);
  assert.ok(Number.isFinite(p.returnPct)&&Number.isFinite(a.returnPct));
});

test('minute gaps fail closed instead of being reconstructed',()=>{
  const bars=[bar(0),bar(1),bar(5)];
  const r=runDynamicGridMonth({bars,stepPct:.01,halfLevels:2});
  assert.equal(r.valid,false);
  assert.match(r.reason,/DATA_GATE:minute data gap/);
});

function fakeCycle(asset,month,ret,{dd=5,reset=2,fill=10,cost=2}={}){
  return{valid:true,asset,month,return:ret,maxDrawdownPct:dd,resets:reset,fills:fill,costs:cost,insufficientWallet:false};
}
function fakePath(ret=.02,staticRet=.01){
  const months=Array.from({length:20},(_,i)=>'202'+Math.floor(i/12+2)+'-'+String(i%12+1).padStart(2,'0'));
  const dyn=[],sta=[];
  for(const m of months)for(const a of ['BTC','ETH']){
    dyn.push(fakeCycle(a,m,ret));
    sta.push(fakeCycle(a,m,staticRet));
  }
  return evaluateDynamicGridPath({dynamicCycles:dyn,staticCycles:sta});
}

test('frozen path gate requires dynamic result to beat same-parameter static grid',()=>{
  const good=fakePath(.02,.01);
  assert.equal(good.pass,true,good.reasons.join(','));
  const bad=fakePath(.005,.01);
  assert.equal(bad.pass,false);
  assert.ok(bad.reasons.includes('DYNAMIC_NOT_ABOVE_STATIC'));
});

test('candidate gate requires both paths plus positive stress and bounded path spread',()=>{
  const p=fakePath(.02,.01),a=fakePath(.018,.009),ps=fakePath(.01,.005),as=fakePath(.008,.004);
  const good=evaluateDynamicGridCandidate({paper:p,alt:a,paperStress:ps,altStress:as});
  assert.equal(good.pass,true,good.reasons.join(','));
  const fail=evaluateDynamicGridCandidate({paper:p,alt:{...a,dynamic:{...a.dynamic,totalReturnPct:-1},pass:false,reasons:['RETURN_NOT_POSITIVE']},paperStress:ps,altStress:as});
  assert.equal(fail.pass,false);
  assert.ok(fail.reasons.some(x=>x.includes('ALT:RETURN_NOT_POSITIVE')));
});

test('summary compounds paired BTC/ETH monthly cycles and reports costs',()=>{
  const cycles=[
    fakeCycle('BTC','2023-01',.1),fakeCycle('ETH','2023-01',.0),
    fakeCycle('BTC','2023-02',.0),fakeCycle('ETH','2023-02',.1)
  ];
  const s=summarizeGridCycles(cycles);
  assert.equal(s.pairedCycles,4);
  assert.equal(s.months,2);
  assert.ok(s.totalReturnPct>10);
  assert.equal(s.costs,8);
});
