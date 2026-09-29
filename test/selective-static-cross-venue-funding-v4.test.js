import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET,
  SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG,
  SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS,
  decideSelectiveStaticV4,
  runSelectiveStaticCrossVenueFundingV4
} from '../research/selective-static-cross-venue-funding-v4.js';

const HOUR=3600000,EIGHT=8*HOUR;

function syntheticAsset({hlRate=.00002,binRate=.00001,price=100}={}){
  const start=Date.UTC(2025,7,1),end=Date.UTC(2026,8,1);
  const binanceFunding=[],hyperliquidFunding=[],binanceMarks=[],hyperliquidMarks=[];
  for(let t=start;t<end;t+=HOUR)hyperliquidFunding.push({time:t,fundingRate:hlRate});
  for(let t=start;t<end;t+=EIGHT){
    binanceFunding.push({fundingTime:t,fundingRate:binRate});
    binanceMarks.push({time:t,close:price});
    hyperliquidMarks.push({time:t,close:price});
  }
  return{binanceFunding,hyperliquidFunding,binanceMarks,hyperliquidMarks};
}
function dataset(opts={}){
  return Object.fromEntries(SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_ASSETS.map(a=>[a,syntheticAsset(opts)]));
}

test('ruleset, threshold and reserved capital are frozen',()=>{
  assert.equal(SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_RULESET,'SELECTIVE-STATIC-CROSS-VENUE-FUNDING-V4-FROZEN');
  assert.equal(SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG.noTradeThreshold,0.0078);
  assert.equal(SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG.portfolioReservedCapital,160000);
  assert.equal(SELECTIVE_STATIC_CROSS_VENUE_FUNDING_V4_CONFIG.validationMonths.length,12);
});

test('V4 never takes the reverse direction',()=>{
  assert.deepEqual(decideSelectiveStaticV4(.008),{active:true,direction:1,label:'LONG_BINANCE_SHORT_HYPERLIQUID'});
  assert.deepEqual(decideSelectiveStaticV4(.00779),{active:false,direction:0,label:'NO_TRADE'});
  assert.deepEqual(decideSelectiveStaticV4(-.02),{active:false,direction:0,label:'NO_TRADE'});
});

test('persistent positive differential trades all slots and uses fixed capital denominator',()=>{
  const r=runSelectiveStaticCrossVenueFundingV4(dataset());
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.dataIntegrityErrors.slice(0,2)));
  assert.equal(r.decisionSlots,96);
  assert.equal(r.activeCycles,96);
  assert.equal(r.noTradeCycles,0);
  assert.equal(r.byAsset.every(x=>x.activeCycles===12),true);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
  const first=r.periods[0];
  assert.ok(Math.abs(first.return-first.netUsd/160000)<1e-12);
});

test('negative prior differential stays flat and pays no cost',()=>{
  const r=runSelectiveStaticCrossVenueFundingV4(dataset({hlRate:-.00002,binRate:.00001}));
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.activeCycles,0);
  assert.equal(r.noTradeCycles,96);
  assert.equal(r.summary.totalCosts,0);
  assert.equal(r.summary.totalNetPnl,0);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('ACTIVE_CYCLES_LT_32'));
});

test('duplicate funding timestamps fail the whole stage closed',()=>{
  const d=dataset();
  d.HBAR.binanceFunding.push({...d.HBAR.binanceFunding[0]});
  const r=runSelectiveStaticCrossVenueFundingV4(d);
  assert.equal(r.dataIntegrityFailure,true);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});
