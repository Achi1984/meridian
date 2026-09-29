import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,
  SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG,
  SELF_HISTORY_PERPETUAL_ELIGIBILITY,
  _test
} from '../research/self-history-perpetual-factor-v1.js';

const H=4*60*60*1000;
const W=7*24*60*60*1000;

function mkRawAsset(anchor,{lastClose=110}={}){
  const bars=[],premium=[],funding=[];
  let p=100;
  for(let k=60;k>=0;k--){
    const t=anchor-k*H;
    const open=p;
    let close=p*(1.001+.0004*Math.sin(k/3));
    if(k===1)close=lastClose;
    bars.push({openTime:t,open,high:Math.max(open,close)*1.001,low:Math.min(open,close)*.999,close});
    premium.push({openTime:t,close:.0002*Math.sin(k/4)});
    p=close;
  }
  for(let t=anchor-14*24*60*60*1000;t<anchor;t+=8*60*60*1000)funding.push({time:t,rate:.0001});
  return{bars,premium,funding};
}

test('MOM7_SKIP4H really skips the latest completed 4h return',()=>{
  const anchor=Date.UTC(2025,0,6);
  const a=_test.indexAsset(mkRawAsset(anchor,{lastClose:110}),SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG);
  const b=_test.indexAsset(mkRawAsset(anchor,{lastClose:180}),SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG);
  const fa=_test.rawFactors(a,anchor,SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG);
  const fb=_test.rawFactors(b,anchor,SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG);
  assert.ok(Math.abs(fa.MOM7_SKIP4H-fb.MOM7_SKIP4H)<1e-12);
  assert.notEqual(fa.REV4H,fb.REV4H);
});

test('foundation eligibility dates are preserved exactly',()=>{
  assert.equal(new Date(SELF_HISTORY_PERPETUAL_ELIGIBILITY.BTC).toISOString().slice(0,10),'2023-01-01');
  assert.equal(new Date(SELF_HISTORY_PERPETUAL_ELIGIBILITY.HBAR).toISOString().slice(0,10),'2023-03-01');
  assert.equal(new Date(SELF_HISTORY_PERPETUAL_ELIGIBILITY.SUI).toISOString().slice(0,10),'2025-05-01');
});

function featureForFactor(zs,raws=zs){
  const assets={};
  Object.keys(zs).forEach(a=>{
    assets[a]={};
    for(const f of ['MOM7_SKIP4H','REV4H','FUND_CROWD','PREMIUM_MR']){
      assets[a][f]={eligible:true,z:zs[a],raw:raws[a]};
    }
  });
  return{anchor:0,assets};
}

test('Self-History factor book is 50/50 dollar-neutral',()=>{
  const feature=featureForFactor({A:2,B:1.5,C:.2,D:-.1,E:-1.4,F:-2});
  const w=_test.selfWeights(feature,'MOM7_SKIP4H',{...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG});
  assert.equal(w.size,4);
  assert.ok(Math.abs([...w.values()].reduce((a,b)=>a+b,0))<1e-12);
  assert.ok(Math.abs([...w.values()].filter(x=>x>0).reduce((a,b)=>a+b,0)-.5)<1e-12);
  assert.ok(Math.abs([...w.values()].filter(x=>x<0).reduce((a,b)=>a+b,0)+.5)<1e-12);
});

test('Cross-Sectional benchmark uses exact max(2,floor(N*0.30)) side count',()=>{
  const assets={};
  for(let i=0;i<10;i++){
    assets['A'+i]={MOM7_SKIP4H:{eligible:true,z:0,raw:i}};
  }
  const w=_test.crossWeights({anchor:0,assets},'MOM7_SKIP4H',{...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG});
  assert.equal([...w.values()].filter(x=>x>0).length,3);
  assert.equal([...w.values()].filter(x=>x<0).length,3);
});

function indexedForBook(rate=.001){
  const assets=['A','B','C','D'];
  const indexed={};
  for(const a of assets){
    indexed[a]={
      barsByOpen:new Map([[0,{open:100}],[W,{open:100}]]),
      funding:[{time:8*60*60*1000,rate}]
    };
  }
  return{assets,indexed};
}
function bookFeatures(activeFactor='MOM7_SKIP4H'){
  const make=(anchor)=>({anchor,assets:Object.fromEntries(['A','B','C','D'].map((a,i)=>{
    const row={};
    for(const f of ['MOM7_SKIP4H','REV4H','FUND_CROWD','PREMIUM_MR'])row[f]={eligible:true,z:0,raw:i};
    row[activeFactor]={eligible:true,z:i<2?1.5:-1.5,raw:i};
    return[a,row];
  }))});
  return[make(0),make(W)];
}

test('positive funding charges longs and rewards shorts',()=>{
  const {assets,indexed}=indexedForBook(.001);
  const out=_test.simulateBook(
    bookFeatures(),indexed,assets,'MOM7_SKIP4H','SELF',
    {...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG},0
  );
  assert.equal(out.dataFailure,false);
  assert.equal(out.periods.length,1);
  assert.ok(Math.abs(out.periods[0].fundingReturn)<1e-12);
});

test('flat factor sleeves are not reallocated to active books',()=>{
  const {assets,indexed}=indexedForBook(0);
  indexed.A.barsByOpen.get(W).open=104;
  indexed.B.barsByOpen.get(W).open=103;
  indexed.C.barsByOpen.get(W).open=97;
  indexed.D.barsByOpen.get(W).open=96;
  const features=bookFeatures('MOM7_SKIP4H');
  const cfg={...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG};
  const p=_test.simulatePortfolio(features,indexed,assets,'SELF',cfg,0);
  const activeBook=p.books.MOM7_SKIP4H.periods[0].netReturn;
  assert.ok(activeBook>0);
  assert.ok(Math.abs(p.periods[0].netReturn-activeBook/4)<1e-12);
  assert.equal(p.books.REV4H.periods[0].active,false);
  assert.equal(p.books.FUND_CROWD.periods[0].active,false);
  assert.equal(p.books.PREMIUM_MR.periods[0].active,false);
});

test('cross-factor turnover is charged independently with no netting',()=>{
  const {assets,indexed}=indexedForBook(0);
  const make=(anchor)=>({anchor,assets:Object.fromEntries(assets.map((a,i)=>{
    const row={};
    row.MOM7_SKIP4H={eligible:true,z:i<2?1.5:-1.5,raw:i};
    row.REV4H={eligible:true,z:i<2?-1.5:1.5,raw:-i};
    row.FUND_CROWD={eligible:true,z:0,raw:i};
    row.PREMIUM_MR={eligible:true,z:0,raw:i};
    return[a,row];
  }))});
  const cfg={...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG};
  const p=_test.simulatePortfolio([make(0),make(W)],indexed,assets,'SELF',cfg,8);
  assert.ok(p.summary.costContributionPct>0);
  assert.ok(p.books.MOM7_SKIP4H.summary.costContributionPct>0);
  assert.ok(p.books.REV4H.summary.costContributionPct>0);
});

test('4x cost stress cannot improve the same positions',()=>{
  const {assets,indexed}=indexedForBook(0);
  indexed.A.barsByOpen.get(W).open=104;
  indexed.B.barsByOpen.get(W).open=103;
  indexed.C.barsByOpen.get(W).open=97;
  indexed.D.barsByOpen.get(W).open=96;
  const features=bookFeatures();
  const cfg={...SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG};
  const base=_test.simulatePortfolio(features,indexed,assets,'SELF',cfg,8);
  const stress=_test.simulatePortfolio(features,indexed,assets,'SELF',cfg,32);
  assert.ok(stress.summary.totalReturnPct<=base.summary.totalReturnPct+1e-12);
  assert.ok(stress.summary.costContributionPct>base.summary.costContributionPct);
});

test('price or premium cadence gaps fail closed',()=>{
  const anchor=Date.UTC(2025,0,6);
  const raw=mkRawAsset(anchor);
  raw.bars.splice(10,1);
  assert.throws(()=>_test.indexAsset(raw,SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG),/BAR_GAP/);
  const raw2=mkRawAsset(anchor);
  raw2.premium.splice(12,1);
  assert.throws(()=>_test.indexAsset(raw2,SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG),/PREMIUM_GAP/);
});

test('discovery anchor generator never crosses into 2026',()=>{
  const start=Date.UTC(2023,0,1);
  const end=Date.UTC(2025,11,31,23,59,59,999);
  for(let weekday=0;weekday<7;weekday++){
    const a=_test.periodAnchors(start,end,weekday,SELF_HISTORY_PERPETUAL_FACTOR_V1_CONFIG);
    if(!a.length)continue;
    assert.ok(a.at(-1)<=end);
    assert.ok(a.every(x=>x<Date.UTC(2026,0,1)));
  }
});

test('ruleset remains research-only by construction',()=>{
  assert.equal(SELF_HISTORY_PERPETUAL_FACTOR_V1_RULESET,'SELF-HISTORY-PERPETUAL-FACTOR-V1-FROZEN');
});
