import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG,
  ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS,
  ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET,
  decideAdaptiveDirection,
  runAdaptiveCrossVenueFundingSpreadV3
} from '../research/adaptive-cross-venue-funding-spread-v3.js';

const HOUR=3600000,EIGHT=8*HOUR;

function months(start,endExclusive){
  const out=[];let d=new Date(start);
  while(d<endExclusive){
    const y=d.getUTCFullYear(),m=d.getUTCMonth();
    const s=Date.UTC(y,m,1),e=m===11?Date.UTC(y+1,0,1):Date.UTC(y,m+1,1);
    out.push({key:y+'-'+String(m+1).padStart(2,'0'),start:s,end:e});
    d=new Date(e);
  }
  return out;
}

function syntheticAsset({hlRate=.00002,binRate=.00001,price=100}={}){
  const start=Date.UTC(2024,8,1),end=Date.UTC(2026,8,1);
  const binanceFunding=[],hyperliquidFunding=[],binanceMarks=[],hyperliquidMarks=[];
  for(let t=start;t<end;t+=HOUR)hyperliquidFunding.push({time:t,fundingRate:hlRate});
  for(let t=start;t<end;t+=EIGHT){
    binanceFunding.push({fundingTime:t,fundingRate:binRate});
    binanceMarks.push({time:t,close:price});
    hyperliquidMarks.push({time:t,close:price});
  }
  return{binanceFunding,hyperliquidFunding,binanceMarks,hyperliquidMarks};
}

function syntheticDataset(opts={}){
  return Object.fromEntries(ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_ASSETS.map(a=>[a,syntheticAsset(opts)]));
}

test('ruleset and cost-derived threshold are frozen',()=>{
  assert.equal(ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_RULESET,'ADAPTIVE-CROSS-VENUE-FUNDING-SPREAD-V3-FROZEN');
  assert.equal(ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG.noTradeThreshold,0.0078);
  assert.equal(ADAPTIVE_CROSS_VENUE_FUNDING_SPREAD_V3_CONFIG.portfolioReservedCapital,160000);
});

test('direction follows only sign of trailing spread above threshold',()=>{
  assert.deepEqual(decideAdaptiveDirection(.01),{active:true,direction:1,label:'LONG_BINANCE_SHORT_HYPERLIQUID'});
  assert.deepEqual(decideAdaptiveDirection(-.01),{active:true,direction:-1,label:'SHORT_BINANCE_LONG_HYPERLIQUID'});
  assert.deepEqual(decideAdaptiveDirection(.00779),{active:false,direction:0,label:'NO_TRADE'});
  assert.deepEqual(decideAdaptiveDirection(-.00779),{active:false,direction:0,label:'NO_TRADE'});
  assert.equal(decideAdaptiveDirection(.0078).active,true);
});

test('small historical spread produces no trade and zero costs',()=>{
  const data=syntheticDataset({hlRate:.0000105,binRate:.00001});
  const r=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false,r.dataIntegrityErrors?.[0]?.reasons?.join(','));
  assert.equal(r.decisionSlots,88);
  assert.equal(r.activeCycles,0);
  assert.equal(r.noTradeCycles,88);
  assert.equal(r.summary.totalCosts,0);
  assert.equal(r.summary.totalNetPnl,0);
  assert.equal(r.summary.totalReturnPct,0);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('ACTIVE_CYCLES_LT_32'));
});

test('synthetic persistent positive differential executes long Binance short Hyperliquid and uses fixed reserved capital denominator',()=>{
  const data=syntheticDataset();
  const r=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false,JSON.stringify(r.dataIntegrityErrors.slice(0,2)));
  assert.equal(r.decisionSlots,88);
  assert.equal(r.activeCycles,88);
  assert.equal(r.binanceLongCycles,88);
  assert.equal(r.hyperliquidLongCycles,0);
  assert.equal(r.noTradeCycles,0);
  assert.equal(r.byAsset.every(x=>x.activeCycles===11),true);
  assert.equal(r.byAsset.every(x=>x.netPnl>0),true);
  assert.equal(r.stressSummary.totalReturnPct>0,true);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));

  const first=r.periods[0];
  const expected=first.netUsd/160000;
  assert.ok(Math.abs(first.return-expected)<1e-12);
});

test('duplicate raw funding timestamps fail the stage closed',()=>{
  const data=syntheticDataset();
  data.HBAR.binanceFunding.push({...data.HBAR.binanceFunding[0]});
  const r=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,true);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('DATA_INTEGRITY_FAILURE'));
});

test('negative trailing differential reverses venue direction',()=>{
  const data=syntheticDataset({hlRate:-.00002,binRate:.00001});
  const r=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'DISCOVERY'});
  assert.equal(r.dataIntegrityFailure,false);
  assert.equal(r.activeCycles,88);
  assert.equal(r.binanceLongCycles,0);
  assert.equal(r.hyperliquidLongCycles,88);
  assert.equal(r.cycles.every(x=>x.direction===-1),true);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
});

test('discovery and holdout have frozen non-overlapping month counts',()=>{
  const data=syntheticDataset();
  const d=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'DISCOVERY'});
  const h=runAdaptiveCrossVenueFundingSpreadV3(data,{stage:'HOLDOUT'});
  assert.equal(d.months.length,11);
  assert.equal(h.months.length,12);
  assert.equal(d.decisionSlots,88);
  assert.equal(h.decisionSlots,96);
  assert.equal(new Set(d.months.filter(x=>h.months.includes(x))).size,0);
});
