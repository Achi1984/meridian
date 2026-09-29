import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS,
  SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG,
  baseTransitionCostUsd,
  stressTransitionCostUsd,
  runSpotPerpFundingPersistenceV2
} from '../research/spot-perp-funding-persistence-v2.js';

const HOUR=3600000;
const BAR=8*HOUR;

function bounds(key){
  const [y,m]=key.split('-').map(Number);
  const start=Date.UTC(y,m-1,1);
  const end=m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1);
  return{start,end};
}

function monthRange(a,b){
  const out=[];
  let [y,m]=a.split('-').map(Number),[ey,em]=b.split('-').map(Number);
  while(y<ey||(y===ey&&m<=em)){
    out.push(y+'-'+String(m).padStart(2,'0'));
    m++;
    if(m===13){y++;m=1;}
  }
  return out;
}

function monthlyKlines(key,price=100){
  const {start,end}=bounds(key),out=[];
  for(let t=start;t<end;t+=BAR){
    out.push([t,t+BAR-1,price,price,price,price]);
  }
  return out;
}

function monthlyFunding(key,rate=.0001){
  const {start,end}=bounds(key),out=[];
  for(let t=start;t<end;t+=BAR)out.push([t,rate]);
  return out;
}

function syntheticAsset({start='2025-08',end='2026-08',fundingRates={},price=100}={}){
  const months=monthRange(start,end);
  return{
    spot:months.flatMap(m=>monthlyKlines(m,price)),
    perp:months.flatMap(m=>monthlyKlines(m,price)),
    funding:months.flatMap(m=>monthlyFunding(m,fundingRates[m]??.0001))
  };
}

function allAssets(opts={}){
  return Object.fromEntries(SPOT_PERP_FUNDING_PERSISTENCE_V2_ASSETS.map(a=>[a,syntheticAsset(opts)]));
}

test('frozen thresholds and transition costs are exact',()=>{
  assert.equal(SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG.entryFundingThreshold,0.00775);
  assert.equal(SPOT_PERP_FUNDING_PERSISTENCE_V2_CONFIG.continuationFundingThreshold,0);
  assert.equal(baseTransitionCostUsd(),21);
  assert.equal(stressTransitionCostUsd(),31);
});

test('state machine enters, persists on positive sub-threshold funding, then exits at non-positive prior funding',()=>{
  const fundingRates={
    '2025-08':.0001,
    '2025-09':.00005,
    '2025-10':-.00001,
    '2025-11':.0001
  };
  const data=allAssets({start:'2025-08',end:'2025-11',fundingRates});
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:['2025-09','2025-10','2025-11']});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.invalid.slice(0,2)));
  assert.equal(r.entryTransitions,8);
  assert.equal(r.continuationMonths,8);
  assert.equal(r.exitTransitions,8);
  assert.equal(r.forcedTerminalExits,0);
  assert.equal(r.activeStateMonths,16);
  assert.equal(r.byAsset.every(x=>x.activeMonths===2),true);
  assert.equal(r.byAsset.every(x=>x.continuationMonths===1),true);
  assert.equal(r.byAsset.every(x=>x.costs===42),true);
});

test('continuation month does not pay an artificial full monthly roundtrip',()=>{
  const fundingRates={'2025-08':.0001,'2025-09':.00005,'2025-10':.00005};
  const data=allAssets({start:'2025-08',end:'2025-10',fundingRates});
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:['2025-09','2025-10']});
  assert.equal(r.entryTransitions,8);
  assert.equal(r.continuationMonths,8);
  assert.equal(r.forcedTerminalExits,8);
  assert.equal(r.summary.totalCosts,8*(21+21));
  assert.equal(r.byAsset.every(x=>x.costs===42),true);
});

test('negative current-month funding is realized honestly after a valid entry signal',()=>{
  const fundingRates={'2025-08':.0001,'2025-09':-.00005};
  const data=allAssets({start:'2025-08',end:'2025-09',fundingRates});
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:['2025-09']});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.invalid.slice(0,2)));
  assert.equal(r.activeStateMonths,8);
  assert.ok(r.summary.totalFundingPnl<0);
  assert.ok(r.summary.totalNetPnl<0);
  assert.equal(r.forcedTerminalExits,8);
});

test('invalid active-month funding fails closed before mutating that asset state',()=>{
  const data=allAssets({start:'2025-08',end:'2025-09'});
  const {start,end}=bounds('2025-09');
  data.OP.funding=data.OP.funding.filter(x=>!(x[0]>=start&&x[0]<end));
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:['2025-09']});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.invalid.some(x=>x.asset==='OP'&&x.month==='2025-09'));
  assert.equal(r.entryTransitions,7);
  assert.equal(r.forcedTerminalExits,7);
  assert.equal(r.byAsset.find(x=>x.asset==='OP').activeMonths,0);
});

test('missing 8h execution bar fails closed without nearest-neighbor repair',()=>{
  const data=allAssets({start:'2025-08',end:'2025-09'});
  const target=data.OP.spot;
  const {start}=bounds('2025-09');
  const idx=target.findIndex(x=>x[0]===start+3*BAR);
  target.splice(idx,1);
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:['2025-09']});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.invalid.some(x=>x.asset==='OP'&&x.month==='2025-09'));
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});

test('fully positive persistent carry path passes the frozen 12-month gate',()=>{
  const data=allAssets({start:'2025-08',end:'2026-08'});
  const months=monthRange('2025-09','2026-08');
  const r=runSpotPerpFundingPersistenceV2(data,{tradeMonths:months});
  assert.equal(r.stateSlots,96);
  assert.equal(r.validStateSlots,96);
  assert.equal(r.rejectedStateSlots,0);
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.activeStateMonths,96);
  assert.equal(r.entryTransitions,8);
  assert.equal(r.continuationMonths,88);
  assert.equal(r.forcedTerminalExits,8);
  assert.equal(r.summary.totalCosts,8*42);
  assert.ok(r.summary.totalFundingPnl>r.summary.totalCosts);
  assert.ok(r.summary.totalReturnPct>0);
  assert.ok(r.stressSummary.totalReturnPct>0);
  assert.equal(r.positiveAssets,8);
  assert.equal(r.positiveWindows,5);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
  assert.equal(r.decision,'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY');
});
