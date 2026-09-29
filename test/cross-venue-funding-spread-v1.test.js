import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_SPREAD_V1_RULESET,
  CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG,
  runCrossVenueFundingSpreadV1
} from '../research/cross-venue-funding-spread-v1.js';

const HOUR=3600000;

function marks(start,end,startPx,driftPer8h=.00005){
  const out=[];let p=startPx;
  for(let t=start;t<end;t+=8*HOUR){
    const close=p*(1+driftPer8h);
    out.push({t, T:t+8*HOUR-1, c:String(close)});
    p=close;
  }
  return out;
}
function binanceMarks(start,end,startPx,driftPer8h=.00005){
  return marks(start,end,startPx,driftPer8h).map(x=>[x.t,String(+x.c/(1+driftPer8h)),x.c,x.c,x.c,'0',x.T]);
}
function funding(start,end,stepHours,rate,venue){
  const out=[];
  for(let t=start;t<end;t+=stepHours*HOUR){
    out.push(venue==='BINANCE'?{fundingTime:t,fundingRate:String(rate)}:{time:t,fundingRate:String(rate)});
  }
  return out;
}
function dataset({hlRate=.00001,binRate=.000005,months=12}={}){
  const start=Date.UTC(2024,0,1),end=Date.UTC(2024+Math.floor(months/12),months%12,1);
  const assets=['BTC','ETH','SOL'];
  return Object.fromEntries(assets.map((a,i)=>{
    const px=[40000,2200,100][i];
    return[a,{
      binanceMarks:binanceMarks(start,end,px,.00004+i*.000005),
      hyperliquidMarks:marks(start,end,px*1.0002,.00004+i*.000005),
      binanceFunding:funding(start,end,8,binRate,'BINANCE'),
      hyperliquidFunding:funding(start,end,1,hlRate,'HL')
    }];
  }));
}

test('V1 remains frozen research-only and uses the predeclared direction',()=>{
  const r=runCrossVenueFundingSpreadV1(dataset());
  assert.equal(r.ruleset,CROSS_VENUE_FUNDING_SPREAD_V1_RULESET);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.direction,'LONG_BINANCE_USDM_PERP_SHORT_HYPERLIQUID_PERP');
  assert.deepEqual(r.config.gate,CROSS_VENUE_FUNDING_SPREAD_V1_CONFIG.gate);
});

test('complete positive synthetic spread clears the frozen discovery gate',()=>{
  const r=runCrossVenueFundingSpreadV1(dataset());
  assert.equal(r.cycles.length,36);
  assert.equal(r.gate.pass,true,r.gate.reasons.join(','));
  assert.ok(r.summary.totalReturnPct>0);
  assert.ok(r.stressSummary.totalReturnPct>0);
  assert.equal(r.byAsset.every(x=>x.cycles===12&&x.netPnl>0),true);
});

test('missing Hyperliquid funding fails closed instead of being inferred',()=>{
  const d=dataset();
  d.SOL.hyperliquidFunding=d.SOL.hyperliquidFunding.filter((_,i)=>i%3===0);
  const r=runCrossVenueFundingSpreadV1(d);
  assert.ok(r.rejected.some(x=>x.asset==='SOL'&&x.reasons.includes('HYPERLIQUID_FUNDING_COUNT')));
  assert.ok(r.gate.reasons.some(x=>x==='SOL_CYCLES_LT_8'));
});

test('cost stress cannot improve a fixed replay',()=>{
  const r=runCrossVenueFundingSpreadV1(dataset());
  assert.ok(r.stressSummary.totalReturnPct<=r.summary.totalReturnPct+1e-12);
  for(const c of r.cycles)assert.ok(c.pnl.stressNetUsd<=c.pnl.netUsd+1e-12);
});
