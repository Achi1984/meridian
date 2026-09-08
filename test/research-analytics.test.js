import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerAnalytics, challengerCounterfactual, paperExecutionAudit, researchComparison } from '../research-analytics.js';

const trade=(pnl,extra={})=>({status:'CLOSED',symbol:'BTCUSDT',side:'LONG',openedAt:'2026-09-01T00:00:00Z',closedAt:'2026-09-01T01:00:00Z',realized:pnl,exitReason:pnl>0?'TP1':'SL',...extra});

test('ledger telemetry computes expectancy payoff, splits and historical max DD',()=>{
  const s={account:{startEquity:10000,equity:10100,peakEquity:10300},equityCurve:[{equity:10000},{equity:10300},{equity:9270},{equity:10100}],positions:[{status:'OPEN',riskPct:.5}],trades:[trade(200),trade(-100,{side:'SHORT',symbol:'ETHUSDT'})]};
  const x=ledgerAnalytics(s,'baseline');
  assert.equal(x.closedTrades,2);
  assert.equal(x.pnl,100);
  assert.equal(x.winRate,50);
  assert.equal(x.profitFactor,2);
  assert.equal(x.expectancy,50);
  assert.equal(x.payoffRatio,2);
  assert.equal(x.maxDrawdownPct,10);
  assert.equal(x.openRiskPct,.5);
  assert.equal(x.bySide.LONG.trades,1);
  assert.equal(x.bySide.SHORT.trades,1);
});

test('challenger counterfactual reports avoided losers, missed winners and R splits',()=>{
  const x=challengerCounterfactual({counterfactuals:[
    {status:'CLOSED',outcomeR:1.4,reason:'WAIT_ENTRY_ZONE',regime:'BULL'},
    {status:'CLOSED',outcomeR:-1,reason:'CONFIDENCE_LT_CAUTION',regime:'RANGE'},
    {status:'OPEN',outcomeR:null,reason:'WAIT_ENTRY_ZONE',regime:'BEAR'}
  ]});
  assert.equal(x.closed,2);
  assert.equal(x.missedWinners,1);
  assert.equal(x.avoidedLosers,1);
  assert.equal(x.netCounterfactualR,.4);
  assert.equal(x.byReason.WAIT_ENTRY_ZONE.netR,1.4);
  assert.equal(x.byReason.CONFIDENCE_LT_CAUTION.netR,-1);
});

test('comparison is research-only and exposes known audit flags',()=>{
  const base={account:{startEquity:10000,equity:9900,peakEquity:10000},equityCurve:[{equity:10000},{equity:9900}],trades:[trade(-100)]};
  const challenger={account:{startEquity:10000,equity:10100,peakEquity:10100},equityCurve:[{equity:10000},{equity:10100}],trades:[trade(100,{challengerDecision:'TRADE',challengerConfidence:80,challengerRegime:'BULL'})],counterfactuals:[]};
  const regime={account:{startEquity:10000,equity:10020,peakEquity:10020},equityCurve:[{equity:10000},{equity:10020}],trades:[trade(20,{sourceSide:'SHORT',side:'LONG',regimeType:'TREND_UP',regimeScore:78,regimeDecision:'TRADE'})]};
  const out=researchComparison({baseline:base,shadow:{},challenger,regime});
  assert.equal(out.researchOnly,true);
  assert.equal(out.executionImpact,false);
  assert.equal(out.ledgers.challenger.vsBaseline.pnlDelta,200);
  assert.equal(out.ledgers.regime.sideAdaptation.trades,1);
  assert.equal(out.auditFlags.challengerBaselineReadyDependency,true);
  assert.equal(out.auditFlags.regimeAdaptedSideUsesBaselineDirectionalScores,true);
});


test('full-ledger execution audit separates price overrun, fees and post-stop re-entry without raw trades',()=>{
  const first=trade(-15,{entry:100,sl:99,exit:98.5,qty:10,feeOpen:1,feeClose:1,openedAt:'2026-09-01T00:00:00Z',closedAt:'2026-09-01T01:00:00Z'});
  const second=trade(10,{entry:99,sl:98,exit:100,qty:10,feeOpen:1,feeClose:1,openedAt:'2026-09-01T01:30:00Z',closedAt:'2026-09-01T02:00:00Z'});
  const out=paperExecutionAudit({baseline:{trades:[first,second]}});
  const b=out.ledgers.baseline;
  assert.equal(out.aggregateOnly,true);
  assert.equal(out.protectedRouteRequired,true);
  assert.equal(b.coverageComplete,true);
  assert.equal(b.stopExecution.evaluable,1);
  assert.equal(b.stopExecution.materialLosses,1);
  assert.equal(b.stopExecution.maximumActualLossR,1.5);
  assert.equal(b.stopExecution.averagePriceLossR,1.5);
  assert.equal(b.stopExecution.averageFeeR,.2);
  assert.equal(b.stopExecution.priceBeyondStop,1);
  assert.equal(b.behavior.postStopReentries,1);
  const keys=[];
  const collect=x=>{if(!x||typeof x!=='object')return;for(const [key,value] of Object.entries(x)){keys.push(key);collect(value);}};
  collect(out);
  for(const forbidden of ['trades','entry','sl','stop','qty','symbol'])assert.equal(keys.includes(forbidden),false);
});

test('research comparison exposes protected aggregate execution audit',()=>{
  const state={trades:[trade(-10,{entry:100,sl:99,exit:99,qty:10,feeOpen:0,feeClose:0})]};
  const out=researchComparison({baseline:state});
  assert.equal(out.executionAudit.schemaVersion,'8.21-PAPER-EXECUTION-AUDIT-V1');
  assert.equal(out.executionAudit.total.closedTrades,1);
  assert.equal(out.executionAudit.executionImpact,false);
});

test('research comparison keeps successor V3 on its own ledger',()=>{
  const v3={account:{startEquity:10000,equity:10025,peakEquity:10025},trades:[trade(25,{challengerDecision:'CAUTION',challengerConfidence:70,challengerRegime:'RANGE'})]};
  const out=researchComparison({challengerV3:v3});
  assert.equal(out.ledgers.challengerV3.pnl,25);
  assert.equal(out.ledgers.challengerV3.byDecision.CAUTION.trades,1);
  assert.equal(out.ledgers.challengerV3.byRegime.RANGE.trades,1);
  assert.equal(out.executionAudit.ledgers.challengerV3.closedTrades,1);
});
