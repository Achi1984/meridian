import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENTED_EDGE_ASSETS,TSMOM_CLASSIC_CONFIG,XSMOM_3W_CONFIG,
  normalizeDaily,tsmomSignal,runTsmomClassic,runXsmom3wPriceProxy,
  evaluateTsmomGate,evaluateXsmomGate,fundingCarryEvidence
} from '../research/documented-edge-v1.js';

const DAY=86400000;
function series(days,drift=.001,phase=0){
  let p=100;const rows=[];
  for(let i=0;i<days;i++){
    const r=drift+Math.sin((i+phase)/7)*.004+Math.cos((i+phase)/19)*.002;
    const open=p;p=Math.max(.01,p*(1+r));
    rows.push({openTime:Date.UTC(2020,0,1)+i*DAY,closeTime:Date.UTC(2020,0,1)+(i+1)*DAY-1,open,high:Math.max(open,p)*1.002,low:Math.min(open,p)*.998,close:p,volume:1000+i});
  }
  return rows;
}
function stableSeries(days,drift=.001,phase=0){
  let p=100;const rows=[];
  for(let i=0;i<days;i++){
    const r=drift+Math.sin((i+phase)/11)*.00015;
    const open=p;p=Math.max(.01,p*(1+r));
    rows.push({openTime:Date.UTC(2020,0,1)+i*DAY,closeTime:Date.UTC(2020,0,1)+(i+1)*DAY-1,open,high:Math.max(open,p)*1.001,low:Math.min(open,p)*.999,close:p,volume:1000+i});
  }
  return rows;
}

test('documented-edge universe is frozen to eight research assets',()=>{
  assert.deepEqual([...DOCUMENTED_EDGE_ASSETS],['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
});

test('TSMOM frozen mechanics use 1m 3m 12m crypto-calendar signals',()=>{
  assert.deepEqual([...TSMOM_CLASSIC_CONFIG.lookbacks],[30,90,365]);
  assert.equal(TSMOM_CLASSIC_CONFIG.rebalanceDays,30);
  assert.equal(TSMOM_CLASSIC_CONFIG.volLookbackDays,60);
  assert.equal(TSMOM_CLASSIC_CONFIG.targetVolAnnual,.10);
  assert.equal(TSMOM_CLASSIC_CONFIG.maxLeverage,2);
});

test('TSMOM signal is long when all frozen lookbacks are positive',()=>{
  const rows=normalizeDaily(stableSeries(500,.0015));
  const ser={rows,by:new Map(rows.map((r,i)=>[r.openTime,i]))};
  const sig=tsmomSignal(ser,rows[400].openTime);
  assert.equal(sig.signal,1);
  assert.deepEqual(sig.signs,[1,1,1]);
});

test('TSMOM multi-asset replication captures persistent up and down trends after costs',()=>{
  const data={
    BTC:series(1250,.0010,0),ETH:series(1250,.0008,3),SOL:series(1250,.0012,7),XRP:series(1250,-.0006,11),
    HBAR:series(1250,.0007,17),LINK:series(1250,-.0005,23),AVAX:series(1250,.0009,29),SUI:series(1250,-.0007,31)
  };
  const r=runTsmomClassic(data);
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.ok(r.summary.periods>=24);
  assert.ok(r.summary.totalReturnPct>0);
  assert.ok(r.summary.profitFactor>1);
  assert.ok(r.assets.length>=4);
});

test('TSMOM gate remains frozen and never auto-promotes',()=>{
  const pass=evaluateTsmomGate(
    {periods:30,profitFactor:1.3,totalReturnPct:12,maxDrawdownPct:8},
    {positiveWindows:4},
    Array.from({length:5},(_,i)=>({symbol:'A'+i,summary:{pnl:100}}))
  );
  assert.equal(pass.pass,true);
  assert.equal(pass.autoPromotion,false);
  const fail=evaluateTsmomGate(
    {periods:10,profitFactor:.9,totalReturnPct:-1,maxDrawdownPct:30},
    {positiveWindows:2},
    [{summary:{pnl:1}}]
  );
  assert.equal(fail.pass,false);
  assert.ok(fail.reasons.includes('PERIODS_LT_24'));
});

test('XSMOM proxy uses 3-week formation, one-day skip and weekly rebalance',()=>{
  assert.equal(XSMOM_3W_CONFIG.formationDays,21);
  assert.equal(XSMOM_3W_CONFIG.skipDays,1);
  assert.equal(XSMOM_3W_CONFIG.rebalanceDays,7);
  assert.equal(XSMOM_3W_CONFIG.topBottomFraction,.30);
  assert.equal(XSMOM_3W_CONFIG.exactReplication,false);
});

test('XSMOM price-only proxy can detect persistent cross-sectional continuation but can never promote',()=>{
  const drifts=[.0014,.0011,.0008,.0005,-.0002,-.0005,-.0008,-.0011];
  const data=Object.fromEntries(DOCUMENTED_EDGE_ASSETS.map((a,i)=>[a,stableSeries(500,drifts[i],i*5)]));
  const r=runXsmom3wPriceProxy(data);
  assert.equal(r.exactReplication,false);
  assert.equal(r.autoPromotion,false);
  assert.ok(r.summary.periods>=52);
  assert.ok(r.summary.totalReturnPct>0);
  assert.equal(r.gate.pass,false);
  assert.ok(r.gate.reasons.includes('EXACT_FACTOR_REQUIRES_HISTORICAL_MARKET_CAP'));
});

test('XSMOM gate is permanently blocked until exact historical market-cap data exists',()=>{
  const g=evaluateXsmomGate({periods:100,profitFactor:2,totalReturnPct:50,maxDrawdownPct:5},{positiveWindows:5});
  assert.equal(g.pass,false);
  assert.equal(g.label,'XSMOM_PROXY_ONLY');
  assert.equal(g.autoPromotion,false);
});

test('Funding Carry evidence reuses frozen Meridian V2 status rather than reopening entries',()=>{
  const e=fundingCarryEvidence();
  assert.equal(e.researchOnly,true);
  assert.equal(e.executionImpact,false);
  assert.equal(e.autoPromotion,false);
  assert.equal(e.newEntriesAllowed,false);
  assert.match(e.retirementReason,/REPEATABILITY_SAMPLE_GATE/);
  assert.ok(e.evidence.some(x=>x.asset==='BTC'&&x.window==='90d'&&x.netUsd>0));
});
