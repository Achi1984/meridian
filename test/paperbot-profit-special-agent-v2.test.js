import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAPERBOT_PROFIT_AGENT_V2_RULESET,
  UPUP_RM_MOMENTUM_PROXY_V1_CONFIG,
  runUpUpRiskManagedMomentumProxyV1
} from '../research/paperbot-profit-special-agent-v2.js';

const DAY=86400000;
function series({days=900,start=100,drift=.001,phase=0,regime=0}={}){
  const rows=[];let p=start;
  for(let i=0;i<days;i++){
    const regimeDrift=regime&&Math.floor(i/140)%2===1?-.0015:.0018;
    const r=(regime?regimeDrift:drift)+Math.sin((i+phase)/23)*.002+Math.sin((i+phase)/61)*.001;
    const open=p,close=Math.max(.01,p*(1+r)),wiggle=.003+Math.abs(r)*.5;
    rows.push({openTime:i*DAY,closeTime:(i+1)*DAY-1,open,high:Math.max(open,close)*(1+wiggle),low:Math.min(open,close)*(1-wiggle),close,volume:1e6+i});
    p=close;
  }
  return rows;
}
function universe(){
  return Object.fromEntries(['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI'].map((a,i)=>[a,series({start:100+i*9,phase:i*5,regime:1})]));
}

test('V2 proxy is research-only and execution neutral',()=>{
  const r=runUpUpRiskManagedMomentumProxyV1(universe());
  assert.equal(r.ruleset,PAPERBOT_PROFIT_AGENT_V2_RULESET);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.exactReplication,false);
});

test('V2 trades only persistent UP-UP weeks after frozen volatility warm-up',()=>{
  const r=runUpUpRiskManagedMomentumProxyV1(universe());
  assert.ok(r.periods.length>=24);
  for(const p of r.periods){
    if(p.active){
      assert.equal(p.upup,true);
      assert.ok(p.scale>0);
      assert.ok(p.scale<=UPUP_RM_MOMENTUM_PROXY_V1_CONFIG.maxGrossLeverage+1e-12);
      assert.ok(p.longs.length>=1&&p.shorts.length>=1);
    }
  }
  const firstActive=r.periods.findIndex(x=>x.active);
  assert.ok(firstActive>=UPUP_RM_MOMENTUM_PROXY_V1_CONFIG.volLookbackWeeks);
});

test('higher modeled costs cannot improve the same V2 replay',()=>{
  const data=universe();
  const low=runUpUpRiskManagedMomentumProxyV1(data,{costBps:0});
  const high=runUpUpRiskManagedMomentumProxyV1(data,{costBps:50});
  assert.ok(high.summary.totalReturnPct<=low.summary.totalReturnPct+1e-9);
  assert.ok(high.diagnostics.totalModeledCostReturn>=low.diagnostics.totalModeledCostReturn);
});

test('V2 exposes beta benchmarks and contribution diagnostics',()=>{
  const r=runUpUpRiskManagedMomentumProxyV1(universe());
  assert.ok(Number.isFinite(r.benchmarks.equalWeightBuyHoldReturnPct));
  assert.ok(Number.isFinite(r.benchmarks.btcBuyHoldReturnPct));
  assert.ok(Number.isFinite(r.diagnostics.activeWeekSharePct));
  assert.ok(Number.isFinite(r.diagnostics.longContributionPct));
  assert.ok(Number.isFinite(r.diagnostics.shortContributionPct));
  assert.ok(Number.isFinite(r.diagnostics.totalTurnover));
});
