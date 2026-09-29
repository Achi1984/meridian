import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_SPREAD_V2_RULESET,
  CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS,
  CROSS_VENUE_FUNDING_SPREAD_V2_GATE,
  runCrossVenueFundingSpreadV2
} from '../research/cross-venue-funding-spread-v2.js';

const HOUR=3600000;

function marks(start,end,startPx,drift=.00003){
  const out=[];let p=startPx;
  for(let t=start;t<end;t+=8*HOUR){
    const close=p*(1+drift);
    out.push({t,T:t+8*HOUR-1,c:String(close)});
    p=close;
  }
  return out;
}
function binanceMarks(start,end,startPx,drift=.00003){
  return marks(start,end,startPx,drift).map(x=>[x.t,String(+x.c/(1+drift)),x.c,x.c,x.c,'0',x.T]);
}
function funding(start,end,stepHours,rate,venue){
  const out=[];
  for(let t=start;t<end;t+=stepHours*HOUR){
    out.push(venue==='BINANCE'?{fundingTime:t,fundingRate:String(rate)}:{time:t,fundingRate:String(rate)});
  }
  return out;
}
function dataset({hlRate=.000012,binRate=.000004,months=24}={}){
  const start=Date.UTC(2024,8,1),end=Date.UTC(2024,8+months,1);
  return Object.fromEntries(CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS.map((a,i)=>{
    const px=50+i*25;
    return[a,{
      binanceMarks:binanceMarks(start,end,px,.00002+i*.000001),
      hyperliquidMarks:marks(start,end,px*1.0001,.00002+i*.000001),
      binanceFunding:funding(start,end,8,binRate,'BINANCE'),
      hyperliquidFunding:funding(start,end,1,hlRate,'HL')
    }];
  }));
}

test('V2 is research-only, fixed-direction and fixed seven-asset validation',()=>{
  const r=runCrossVenueFundingSpreadV2(dataset());
  assert.equal(r.ruleset,CROSS_VENUE_FUNDING_SPREAD_V2_RULESET);
  assert.equal(r.stage,'INDEPENDENT_VALIDATION');
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.direction,'LONG_BINANCE_USDM_PERP_SHORT_HYPERLIQUID_PERP');
  assert.deepEqual(r.assets,[...CROSS_VENUE_FUNDING_SPREAD_V2_ASSETS]);
  assert.deepEqual(r.config.gate,CROSS_VENUE_FUNDING_SPREAD_V2_GATE);
});

test('complete positive 24-month seven-asset replay can pass the frozen validation gate',()=>{
  const r=runCrossVenueFundingSpreadV2(dataset());
  assert.equal(r.cycles.length,168);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
  assert.equal(r.decision,'VALIDATION_PASS_PROSPECTIVE_PAPER_SHADOW_ONLY');
  assert.ok(r.summary.totalReturnPct>0);
  assert.ok(r.stressSummary.totalReturnPct>0);
  assert.equal(r.byAsset.every(x=>x.cycles===24&&x.netPnl>0),true);
});

test('one non-positive asset fails the all-assets-positive rule',()=>{
  const d=dataset({hlRate:.000012,binRate:.000004});
  d.ETC.hyperliquidFunding=d.ETC.hyperliquidFunding.map(x=>({...x,fundingRate:'-0.000020'}));
  const r=runCrossVenueFundingSpreadV2(d);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('ETC_PNL_NOT_POSITIVE'));
  assert.equal(r.decision,'VALIDATION_FAIL_RESEARCH_REDESIGN');
});

test('missing full funding coverage fails cycle counts rather than being reconstructed',()=>{
  const d=dataset();
  d.DOT.hyperliquidFunding=d.DOT.hyperliquidFunding.filter((_,i)=>i%3===0);
  const r=runCrossVenueFundingSpreadV2(d);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('DOT_CYCLES_LT_20'));
  assert.ok(r.rejected.some(x=>x.asset==='DOT'&&x.reasons.includes('HYPERLIQUID_FUNDING_COUNT')));
});

test('stress never improves a fixed V2 replay',()=>{
  const r=runCrossVenueFundingSpreadV2(dataset());
  assert.ok(r.stressSummary.totalReturnPct<=r.summary.totalReturnPct+1e-12);
  for(const c of r.cycles)assert.ok(c.pnl.stressNetUsd<=c.pnl.netUsd+1e-12);
});
