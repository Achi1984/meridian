import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELF_HISTORY_PERP_FACTOR_V1_RULESET,
  SELF_HISTORY_PERP_FACTOR_V1_CONFIG,
  runSelfHistoryPerpFactorV1,
  _test
} from '../research/self-history-perp-factor-v1.js';

const H=8*60*60*1000;
const W=7*24*60*60*1000;

test('own-history percentile excludes current observation and is deterministic',()=>{
  assert.equal(_test.percentileAgainstHistory(9,[1,2,3,4,5,6,7,8,9,10]),0.9);
  assert.equal(_test.percentileAgainstHistory(0,[1,2,3,4]),0);
  assert.equal(_test.percentileAgainstHistory(5,[1,2,3,4]),1);
});

test('own-history weights are 50/50 dollar-neutral when both sides qualify',()=>{
  const feature={assets:{
    A:{eligible:true,percentile:.95,momentum:.4},
    B:{eligible:true,percentile:.85,momentum:.3},
    C:{eligible:true,percentile:.55,momentum:.2},
    D:{eligible:true,percentile:.45,momentum:.1},
    E:{eligible:true,percentile:.15,momentum:-.1},
    F:{eligible:true,percentile:.05,momentum:-.2},
    G:{eligible:true,percentile:.60,momentum:.05},
    H:{eligible:true,percentile:.40,momentum:-.05}
  }};
  const w=_test.ownHistoryWeights(feature,SELF_HISTORY_PERP_FACTOR_V1_CONFIG);
  assert.equal(w.size,4);
  assert.ok(Math.abs([...w.values()].reduce((a,b)=>a+b,0))<1e-12);
  assert.ok(Math.abs([...w.values()].filter(x=>x>0).reduce((a,b)=>a+b,0)-.5)<1e-12);
  assert.ok(Math.abs([...w.values()].filter(x=>x<0).reduce((a,b)=>a+b,0)+.5)<1e-12);
});

test('cross-sectional benchmark uses exact max(2,floor(N/4)) side count',()=>{
  const assets={};
  for(let i=0;i<12;i++)assets['A'+i]={eligible:true,momentum:i,percentile:.5};
  const w=_test.crossSectionWeights({assets},{...SELF_HISTORY_PERP_FACTOR_V1_CONFIG,minEligibleAssets:8});
  assert.equal([...w.values()].filter(x=>x>0).length,3);
  assert.equal([...w.values()].filter(x=>x<0).length,3);
  assert.ok(Math.abs([...w.values()].reduce((a,b)=>a+b,0))<1e-12);
});

function indexedFlat(rate=.001){
  const assets=['A','B','C','D'];
  const indexed={};
  for(const a of assets){
    indexed[a]={
      byOpen:new Map([[0,{open:100}],[W,{open:100}]]),
      funding:[{time:H,rate}]
    };
  }
  return{assets,indexed};
}
function twoFeatures(){
  const mk=(anchor)=>({anchor,assets:{
    A:{eligible:true,percentile:.95,momentum:.4},
    B:{eligible:true,percentile:.85,momentum:.3},
    C:{eligible:true,percentile:.15,momentum:-.3},
    D:{eligible:true,percentile:.05,momentum:-.4}
  }});
  return[mk(0),mk(W)];
}

test('positive funding charges longs and rewards shorts with correct sign',()=>{
  const {assets,indexed}=indexedFlat(.001);
  const cfg={...SELF_HISTORY_PERP_FACTOR_V1_CONFIG,minLongs:1,minShorts:1,minEligibleAssets:4};
  const r=_test.simulate(twoFeatures(),indexed,assets,_test.ownHistoryWeights,cfg,0);
  assert.equal(r.completedPeriods,1);
  assert.ok(r.longGrossContributionPct<0);
  assert.ok(r.shortGrossContributionPct>0);
  assert.ok(Math.abs(r.fundingContributionPct)<1e-12);
});

test('final exit is charged instead of disappearing for free',()=>{
  const {assets,indexed}=indexedFlat(0);
  const cfg={...SELF_HISTORY_PERP_FACTOR_V1_CONFIG,minLongs:1,minShorts:1,minEligibleAssets:4};
  const r=_test.simulate(twoFeatures(),indexed,assets,_test.ownHistoryWeights,cfg,8);
  assert.equal(r.completedPeriods,1);
  assert.ok(Math.abs(r.turnover-2)<1e-12,'entry gross 1 + final close gross 1');
  assert.ok(Math.abs(r.costContributionPct-.16)<1e-9);
  assert.ok(r.totalReturnPct<0);
});

test('higher cost cannot improve identical factor replay',()=>{
  const {assets,indexed}=indexedFlat(0);
  indexed.A.byOpen.get(W).open=104;
  indexed.B.byOpen.get(W).open=103;
  indexed.C.byOpen.get(W).open=97;
  indexed.D.byOpen.get(W).open=96;
  const cfg={...SELF_HISTORY_PERP_FACTOR_V1_CONFIG,minLongs:1,minShorts:1,minEligibleAssets:4};
  const base=_test.simulate(twoFeatures(),indexed,assets,_test.ownHistoryWeights,cfg,8);
  const stress=_test.simulate(twoFeatures(),indexed,assets,_test.ownHistoryWeights,cfg,32);
  assert.ok(stress.totalReturnPct<=base.totalReturnPct+1e-12);
  assert.ok(stress.costContributionPct>base.costContributionPct);
});

test('8h bar gaps fail closed',()=>{
  const bars=[
    {openTime:0,closeTime:H-1,open:100,high:101,low:99,close:100},
    {openTime:2*H,closeTime:3*H-1,open:100,high:101,low:99,close:100}
  ];
  const funding=[{time:H,rate:0},{time:2*H,rate:0}];
  assert.throws(()=>_test.indexAsset({bars,funding},SELF_HISTORY_PERP_FACTOR_V1_CONFIG),/BAR_GAP/);
});

function syntheticAsset({start=Date.UTC(2020,9,1),weeks=180,phase=0,drift=.00008}={}){
  const bars=[],funding=[];
  const end=start+weeks*W;
  let p=100;
  for(let t=start,i=0;t<=end;t+=H,i++){
    const cyc=.0015*Math.sin((i+phase)/35)+.0009*Math.sin((i+phase)/91);
    const open=p,close=Math.max(.01,p*(1+drift+cyc));
    bars.push({openTime:t,closeTime:t+H-1,open,high:Math.max(open,close)*1.001,low:Math.min(open,close)*.999,close});
    p=close;
    if(t>start)funding.push({time:t,rate:.00001*Math.sin((i+phase)/17)});
  }
  return{bars,funding};
}

test('full engine is research-only and includes the frozen final exit period',()=>{
  const assets=['A','B','C','D','E','F','G','H'];
  const dataset=Object.fromEntries(assets.map((a,i)=>[a,syntheticAsset({phase:i*13,drift:(i<4?.00012:-.00002)})]));
  const start=Date.UTC(2022,3,4),end=Date.UTC(2022,6,4);
  const r=runSelfHistoryPerpFactorV1(dataset,{
    assets,start,endExclusive:end,phase:'DISCOVERY',
    config:{
      minEligibleAssets:8,minLongs:1,minShorts:1,
      momentumWeeks:2,ownHistoryWeeks:4,
      discoveryGate:{minPeriods:1,minActiveWeeks:0,minProfitFactor:0,minSharpe:-99,maxDrawdownPct:100,minPositiveWindows:0,minPositiveAssets:0,maxPositivePnlConcentrationPct:100}
    }
  });
  assert.equal(r.ruleset,SELF_HISTORY_PERP_FACTOR_V1_RULESET);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.ok(r.ownHistory.completedPeriods>=12);
  assert.equal(r.ownHistory.periods.at(-1).next,end);
});
