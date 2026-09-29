import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS,
  SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG,
  basisBaseRoundTripCostUsd,
  basisStressRoundTripCostUsd,
  nearestRankPercentile,
  runSpotPerpBasisDislocationV1
} from '../research/spot-perp-basis-dislocation-v1.js';

const H=3600000;
const BAR=8*H;
const START=Date.UTC(2024,5,1);
const END=Date.UTC(2024,9,1);

function buildAsset({entryBasis=.009,signalBasis=.010,fundingRate=.0001,breakSync=false}={}){
  const spot=[],perp=[],funding=[];
  for(let t=START;t<END;t+=BAR){
    const sOpen=100,sClose=100;
    let pOpen=100.1,pClose=100.1;
    spot.push([t,t+BAR-1,sOpen,sOpen,sOpen,sClose]);
    perp.push([t,t+BAR-1,pOpen,pOpen,pOpen,pClose]);
    funding.push([t,fundingRate]);
  }
  const signalTime=Date.UTC(2024,8,2,0);
  const signalIdx=spot.findIndex(x=>x[0]===signalTime);
  const entryIdx=signalIdx+1;
  const exitIdx=entryIdx+3;
  perp[signalIdx][5]=100*(1+signalBasis);
  perp[signalIdx][3]=Math.max(perp[signalIdx][3],perp[signalIdx][5]);
  perp[signalIdx][4]=Math.min(perp[signalIdx][4],perp[signalIdx][5]);
  perp[entryIdx][2]=100*(1+entryBasis);
  perp[entryIdx][3]=Math.max(perp[entryIdx][2],100.1);
  perp[entryIdx][4]=Math.min(perp[entryIdx][2],100.1);
  perp[entryIdx][5]=100.1;
  perp[exitIdx][2]=100.1;
  perp[exitIdx][3]=100.1;
  perp[exitIdx][4]=100.1;
  perp[exitIdx][5]=100.1;
  if(breakSync)perp.splice(signalIdx-10,1);
  return{spot,perp,funding,signalTime,entryTime:spot[entryIdx][0],exitTime:spot[exitIdx][0]};
}

function dataset(opts={}){
  const out={};
  for(const a of SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS)out[a]=buildAsset(opts);
  return out;
}

test('frozen cost and basis floors remain exact',()=>{
  assert.equal(basisBaseRoundTripCostUsd(),42);
  assert.equal(basisStressRoundTripCostUsd(),62);
  assert.equal(SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG.signalBasisFloor,0.00775);
  assert.equal(SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG.executionBasisFloor,0.0062);
  assert.equal(SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG.historyBars,270);
  assert.equal(SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG.historyPercentile,0.95);
  assert.equal(SPOT_PERP_BASIS_DISLOCATION_V1_CONFIG.holdMs,24*H);
});

test('nearest-rank 95th percentile follows frozen estimator',()=>{
  const xs=Array.from({length:270},(_,i)=>i);
  assert.equal(nearestRankPercentile(xs,.95),256);
});

test('qualified dislocation enters at next 8h open and exits exactly 24h later',()=>{
  const d=dataset();
  const r=runSpotPerpBasisDislocationV1(d,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.dataIntegrityErrors.slice(0,2)));
  assert.equal(r.completedTrades,8);
  for(const a of SPOT_PERP_BASIS_DISLOCATION_V1_ASSETS){
    const tr=r.trades.find(x=>x.asset===a);
    assert.ok(tr);
    assert.equal(tr.exitTime-tr.entryTime,24*H);
    assert.ok(tr.signalBasis>=.00775);
    assert.ok(tr.entryBasis>=.0062);
    assert.ok(tr.fundingConfirm>0);
    assert.ok(tr.basisCompression>0);
    assert.ok(tr.pnl.basisUsd>0);
    assert.ok(tr.pnl.fundingUsd>0);
  }
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('TRADES_LT_32'));
});

test('execution basis below stressed breakeven cancels entry with zero trade cost',()=>{
  const d=dataset({entryBasis:.005});
  const r=runSpotPerpBasisDislocationV1(d,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.completedTrades,0);
  assert.equal(r.cancelledByExecutionBasis,8);
  assert.equal(r.summary.totalCosts,0);
});

test('non-positive trailing funding confirmation blocks otherwise valid entry',()=>{
  const d=dataset({fundingRate:-.0001});
  const r=runSpotPerpBasisDislocationV1(d,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.completedTrades,0);
  assert.equal(r.percentileQualifiedSignals,8);
  assert.equal(r.summary.totalCosts,0);
});

test('sub-floor signal basis cannot trade even when own-history percentile is low',()=>{
  const d=dataset({signalBasis:.006,entryBasis:.009});
  const r=runSpotPerpBasisDislocationV1(d,{stage:'DISCOVERY'});
  assert.equal(r.completedTrades,0);
  assert.equal(r.percentileQualifiedSignals,0);
});

test('synchronization gap fails closed instead of nearest-neighbor repair',()=>{
  const d=dataset();
  d.APT=buildAsset({breakSync:true});
  const r=runSpotPerpBasisDislocationV1(d,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.dataIntegrityErrors.some(x=>x.asset==='APT'&&/ROW_COUNT_MISMATCH|TIMESTAMP_MISMATCH/.test(x.reason)));
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});

test('fixed portfolio denominator does not scale up when only eight synthetic trades exist',()=>{
  const r=runSpotPerpBasisDislocationV1(dataset(),{stage:'DISCOVERY'});
  const pnl=r.months.reduce((s,x)=>s+x.netUsd,0);
  const sep=r.months.find(x=>x.month==='2024-09');
  assert.ok(sep);
  assert.equal(sep.return,sep.netUsd/160000);
  assert.ok(Math.abs(pnl-r.summary.totalNetPnl)<1e-9);
});

// CI retrigger after pre-PnL invariant fixes.
