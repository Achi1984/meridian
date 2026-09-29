import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPOT_PERP_FUNDING_HARVEST_V2_ASSETS,
  SPOT_PERP_FUNDING_HARVEST_V2_CONFIG,
  entryCostUsd,
  exitCostUsd,
  runSpotPerpFundingHarvestV2
} from '../research/spot-perp-funding-harvest-v2-persistent.js';

const H=3600000;
const EIGHT=8*H;

function monthKeys(startY,startM,count){
  const out=[];
  let y=startY,m=startM;
  for(let i=0;i<count;i++){
    out.push(y+'-'+String(m).padStart(2,'0'));
    m++;if(m===13){m=1;y++;}
  }
  return out;
}
function bounds(key){
  const [y,m]=key.split('-').map(Number);
  return{start:Date.UTC(y,m-1,1),end:m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1)};
}
function monthlyKlines(key,price=100){
  const {start,end}=bounds(key);
  const out=[];
  for(let t=start;t<end;t+=EIGHT)out.push([t,t+EIGHT-1,price,price,price,price]);
  return out;
}
function monthlyFunding(key,rate=.0001){
  const {start,end}=bounds(key);
  const out=[];
  for(let t=start;t<end;t+=EIGHT)out.push([t,rate]);
  return out;
}
function syntheticAsset({
  fundingRates={},
  spotPrices={},
  perpPrices={},
  defaultFunding=.0001,
  defaultSpot=100,
  defaultPerp=100
}={}){
  const months=monthKeys(2024,9,12);
  return{
    spot:months.flatMap(m=>monthlyKlines(m,spotPrices[m]??defaultSpot)),
    perp:months.flatMap(m=>monthlyKlines(m,perpPrices[m]??defaultPerp)),
    funding:months.flatMap(m=>monthlyFunding(m,fundingRates[m]??defaultFunding))
  };
}
function datasetAll(factory){
  const d={};
  for(const a of SPOT_PERP_FUNDING_HARVEST_V2_ASSETS)d[a]=factory(a);
  return d;
}

const discoveryMonths=monthKeys(2024,10,11);

test('frozen persistent V2 entry and exit costs are 21/31 at unchanged notional',()=>{
  assert.equal(entryCostUsd({},false),21);
  assert.equal(entryCostUsd({},true),31);
  const state={spotNotional:10000,perpNotional:10000};
  assert.equal(exitCostUsd(state,{},false),21);
  assert.equal(exitCostUsd(state,{},true),31);
  assert.equal(SPOT_PERP_FUNDING_HARVEST_V2_CONFIG.entryThreshold,0.00775);
  assert.equal(SPOT_PERP_FUNDING_HARVEST_V2_CONFIG.holdThresholdExclusive,0);
});

test('persistent positive carry enters once, does not churn monthly, and closes only at stage end',()=>{
  const data=datasetAll(()=>syntheticAsset());
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:discoveryMonths,stage:'DEVELOPMENT'});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.invalid.slice(0,2)));
  assert.equal(r.decisionSlots,88);
  assert.equal(r.exposureMonths,88);
  assert.equal(r.entryEvents,8);
  assert.equal(r.exitEvents,8);
  assert.equal(r.persistentHoldMonths,72);
  assert.equal(r.averageHoldingStreakLength,11);
  assert.equal(r.summary.totalCosts,336);
  assert.equal(r.byAsset.every(x=>x.entryEvents===1&&x.exitEvents===1&&x.exposureMonths===11),true);
  const op=r.slots.filter(x=>x.asset==='OP');
  assert.equal(op[0].transition,'ENTER');
  assert.equal(op.at(-1).transition,'HOLD_FINAL_EXIT');
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
});

test('active position remains active when prior funding stays positive but falls below entry threshold',()=>{
  const rates={'2024-09':.0001,'2024-10':.00001,'2024-11':.0001};
  const data=datasetAll(()=>syntheticAsset({fundingRates:rates}));
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:['2024-10','2024-11'],stage:'DEVELOPMENT'});
  const op=r.slots.filter(x=>x.asset==='OP');
  assert.equal(op[0].transition,'ENTER');
  assert.equal(op[1].transition,'HOLD_FINAL_EXIT');
  assert.ok(op[1].signalFunding>0);
  assert.ok(op[1].signalFunding<SPOT_PERP_FUNDING_HARVEST_V2_CONFIG.entryThreshold);
});

test('non-positive prior funding exits, EXIT counts as exposure, and later strong funding can re-enter',()=>{
  const rates={
    '2024-09':.0001,
    '2024-10':.0001,
    '2024-11':-.0001,
    '2024-12':.0001,
    '2025-01':.0001
  };
  const data=datasetAll(()=>syntheticAsset({fundingRates:rates}));
  const months=['2024-10','2024-11','2024-12','2025-01'];
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:months,stage:'DEVELOPMENT'});
  const op=r.slots.filter(x=>x.asset==='OP');
  assert.deepEqual(op.map(x=>x.transition),['ENTER','HOLD','EXIT','ENTER_FINAL_EXIT']);
  const a=r.byAsset.find(x=>x.asset==='OP');
  assert.equal(a.exposureMonths,4);
  assert.equal(a.entryEvents,2);
  assert.equal(a.exitEvents,2);
  assert.equal(a.persistentHoldMonths,1);
});

test('continuous mark accounting captures month-boundary price move during HOLD',()=>{
  const data=datasetAll(a=>{
    if(a!=='OP')return syntheticAsset({defaultFunding:.00001});
    return syntheticAsset({
      fundingRates:{'2024-09':.0001,'2024-10':.0001,'2024-11':.0001},
      spotPrices:{'2024-10':100,'2024-11':150},
      perpPrices:{'2024-10':100,'2024-11':100}
    });
  });
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:['2024-10','2024-11'],stage:'DEVELOPMENT'});
  const nov=r.slots.find(x=>x.asset==='OP'&&x.month==='2024-11');
  assert.equal(nov.transition,'HOLD_FINAL_EXIT');
  assert.equal(nov.pnl.basisPnl,5000);
});

test('monthly portfolio return always uses frozen 160k denominator',()=>{
  const data=datasetAll(a=>syntheticAsset({defaultFunding:a==='OP'?.0001:.00001}));
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:['2024-10'],stage:'DEVELOPMENT'});
  assert.equal(r.periods[0].return,r.periods[0].netUsd/160000);
  assert.equal(r.periods[0].stressReturn,r.periods[0].stressNetUsd/160000);
});

test('missing required 8h row during an active streak fails closed',()=>{
  const data=datasetAll(()=>syntheticAsset());
  const {start}=bounds('2024-11');
  const idx=data.OP.spot.findIndex(x=>x[0]===start+5*EIGHT);
  data.OP.spot.splice(idx,1);
  const r=runSpotPerpFundingHarvestV2(data,{tradeMonths:['2024-10','2024-11','2024-12'],stage:'DEVELOPMENT'});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.invalid.some(x=>x.asset==='OP'&&x.month==='2024-11'));
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});
