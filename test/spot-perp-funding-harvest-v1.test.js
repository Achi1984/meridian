import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPOT_PERP_FUNDING_HARVEST_V1_ASSETS,
  SPOT_PERP_FUNDING_HARVEST_V1_CONFIG,
  baseRoundTripCostUsd,
  stressRoundTripCostUsd,
  runSpotPerpFundingHarvestV1
} from '../research/spot-perp-funding-harvest-v1.js';

const H=3600000;
const EIGHT=8*H;

function monthKeys(startY,startM,count){
  const out=[];
  let y=startY,m=startM;
  for(let i=0;i<count;i++){
    out.push(y+'-'+String(m).padStart(2,'0'));
    m++; if(m===13){m=1;y++;}
  }
  return out;
}

function bounds(key){
  const [y,m]=key.split('-').map(Number);
  return {
    start:Date.UTC(y,m-1,1),
    end:m===12?Date.UTC(y+1,0,1):Date.UTC(y,m,1)
  };
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

function syntheticAsset({fundingRate=.0001,price=100}={}){
  const months=monthKeys(2024,9,12);
  return {
    spot:months.flatMap(m=>monthlyKlines(m,price)),
    perp:months.flatMap(m=>monthlyKlines(m,price)),
    funding:months.flatMap(m=>monthlyFunding(m,fundingRate))
  };
}

const discoveryMonths=monthKeys(2024,10,11);

test('frozen costs are exactly 42 base and 62 stress',()=>{
  assert.equal(baseRoundTripCostUsd(),42);
  assert.equal(stressRoundTripCostUsd(),62);
});

test('funding threshold is exactly 77.5 bps',()=>{
  assert.equal(SPOT_PERP_FUNDING_HARVEST_V1_CONFIG.fundingThreshold,0.00775);
});

test('strong positive prior funding activates all 88 discovery slots and passes synthetic economics',()=>{
  const data={};
  for(const a of SPOT_PERP_FUNDING_HARVEST_V1_ASSETS)data[a]=syntheticAsset({fundingRate:.0001});
  const r=runSpotPerpFundingHarvestV1(data,{tradeMonths:discoveryMonths,stage:'DISCOVERY'});
  assert.equal(r.decisionSlots,88);
  assert.equal(r.rejectedDecisionSlots,0);
  assert.equal(r.activeCycles,88);
  assert.equal(r.noTradeCycles,0);
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.byAsset.every(x=>x.activeCycles===11),true);
  assert.equal(r.summary.totalCosts,88*42);
  assert.ok(r.summary.totalFundingPnl>r.summary.totalCosts);
  assert.ok(r.summary.totalReturnPct>0);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
});

test('sub-threshold prior funding creates NO TRADE with fixed opportunity capital',()=>{
  const data={};
  for(const a of SPOT_PERP_FUNDING_HARVEST_V1_ASSETS)data[a]=syntheticAsset({fundingRate:.00005});
  const r=runSpotPerpFundingHarvestV1(data,{tradeMonths:discoveryMonths,stage:'DISCOVERY'});
  assert.equal(r.decisionSlots,88);
  assert.equal(r.activeCycles,0);
  assert.equal(r.noTradeCycles,88);
  assert.equal(r.summary.totalNetPnl,0);
  assert.equal(r.summary.totalReturnPct,0);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('ACTIVE_CYCLES_LT_32'));
});

test('missing active-month 8h bar fails closed instead of nearest-neighbor repair',()=>{
  const data={};
  for(const a of SPOT_PERP_FUNDING_HARVEST_V1_ASSETS)data[a]=syntheticAsset({fundingRate:.0001});
  const target=data.OP.spot;
  const octStart=bounds('2024-10').start;
  const idx=target.findIndex(x=>x[0]===octStart+5*EIGHT);
  target.splice(idx,1);
  const r=runSpotPerpFundingHarvestV1(data,{tradeMonths:discoveryMonths,stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,true);
  assert.ok(r.invalid.some(x=>x.asset==='OP'&&x.month==='2024-10'));
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});

test('current-month negative funding is realized honestly even after positive prior signal',()=>{
  const data={};
  for(const a of SPOT_PERP_FUNDING_HARVEST_V1_ASSETS)data[a]=syntheticAsset({fundingRate:.0001});
  const op=data.OP;
  const {start,end}=bounds('2024-10');
  for(const row of op.funding)if(row[0]>=start&&row[0]<end)row[1]=-.0001;
  const r=runSpotPerpFundingHarvestV1(data,{tradeMonths:discoveryMonths,stage:'DISCOVERY'});
  const opResult=r.byAsset.find(x=>x.asset==='OP');
  assert.ok(opResult.fundingPnl<0);
  assert.ok(r.signalDiagnostics.signAgreementRate<1);
});
