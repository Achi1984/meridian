import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {REGIME_TREND_BREAKOUT_V1} from '../research/paper-profit-regime-trend-breakout-v1-preregistration.js';
import {
  freezeRegimeTrendBreakoutSplit,
  indicatorRows,
  nextRegimeTrendBreakoutDirection,
  targetWeightsFromStates,
  runRegimeTrendBreakoutV1Discovery
} from '../research/paper-profit-regime-trend-breakout-v1-evaluator.js';

const DAY=86400000;
function rows(days=700,{flat=false,drift=.001}={}){
  const start=Date.UTC(2023,0,1),out=[];
  let p=100;
  for(let i=0;i<days;i++){
    if(!flat)p*=1+drift;
    const close=flat?100:p,open=flat?100:(i?out.at(-1).close:close/(1+drift));
    out.push({openTime:start+i*DAY,closeTime:start+(i+1)*DAY-1,open,high:close*1.01,low:close*.99,close,volume:1});
  }
  return out;
}
function dataset(days=700,opts={flat:true}){
  return Object.fromEntries(REGIME_TREND_BREAKOUT_V1.universe.map(s=>[s,rows(days,opts)]));
}

test('Regime Trend Breakout V1 is fully frozen before results',()=>{
  const x=REGIME_TREND_BREAKOUT_V1;
  assert.equal(x.ruleset,'PAPER-PROFIT-REGIME-TREND-BREAKOUT-V1');
  assert.deepEqual(x.universe,['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']);
  assert.equal(x.regime.adxPeriod,14);
  assert.equal(x.regime.minAdx,25);
  assert.equal(x.regime.smaPeriod,200);
  assert.equal(x.breakout.entryChannelDays,55);
  assert.equal(x.breakout.exitChannelDays,20);
  assert.equal(x.sizing.realizedVolDays,60);
  assert.equal(x.sizing.targetVolAnnual,0.10);
  assert.equal(x.sizing.maxLeverage,2);
  assert.equal(x.costs.baselineBps,8);
  assert.equal(x.costs.stressBps,16);
  assert.equal(x.split.discoveryFraction,0.70);
  assert.equal(x.split.holdoutFraction,0.30);
  assert.equal(x.split.holdoutBlockedUntilDiscoveryPass,true);
  assert.equal(x.gate.maxDrawdownPct,20);
  assert.equal(x.gate.minProfitFactor,1.15);
  assert.equal(x.executionImpact,false);
  assert.equal(x.autoPromotion,false);
});

test('TSMOM V2 frozen result keeps holdout untouched after discovery fail',()=>{
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-TSMOM-V2-RESULT.md','utf8');
  assert.ok(doc.includes('TSMOM_V2_DISCOVERY_FAIL'));
  assert.ok(doc.includes('Holdout returns were **not evaluated**'));
  assert.ok(doc.includes('Artifact: **11113377407**'));
});

test('frozen split is deterministic 70/30 on common timestamps',()=>{
  const xs=Array.from({length:100},(_,i)=>Date.UTC(2024,0,1)+i*DAY);
  const s=freezeRegimeTrendBreakoutSplit(xs);
  assert.equal(s.ok,true);
  assert.equal(s.discoveryCount,70);
  assert.equal(s.holdoutCount,30);
  assert.equal(s.discoveryTo,xs[69]);
  assert.equal(s.holdoutFrom,xs[70]);
});

test('55-day breakout channel excludes the current bar high',()=>{
  const xs=rows(260,{flat:false,drift:.002});
  xs.at(-1).high=10000;
  xs.at(-1).close=xs.at(-2).high*1.02;
  const ind=indicatorRows(xs),last=ind.at(-1);
  assert.ok(last.entryHigh<10000,'current high must not contaminate prior-55 channel');
  assert.ok(last.adx>=25,'monotonic synthetic trend should be strong');
  assert.ok(last.close>last.sma200);
  assert.equal(nextRegimeTrendBreakoutDirection(0,last),1);
});

test('exit bar cannot reverse directly into the opposite side',()=>{
  const row={adx:40,close:80,sma200:100,entryHigh:120,entryLow:90,exitHigh:110,exitLow:95};
  assert.equal(nextRegimeTrendBreakoutDirection(1,row),0);
  assert.equal(nextRegimeTrendBreakoutDirection(0,row),-1);
});

test('volatility-normalized equal active allocation is bounded by 2x gross',()=>{
  const w=targetWeightsFromStates({
    BTC:{direction:1,realizedVolAnnual:.05},
    ETH:{direction:-1,realizedVolAnnual:.10},
    SOL:{direction:0,realizedVolAnnual:.03}
  });
  assert.equal(w.BTC,1);
  assert.equal(w.ETH,-.5);
  assert.equal(w.SOL,0);
  assert.ok(Object.values(w).reduce((a,x)=>a+Math.abs(x),0)<=2);
});

test('Discovery failure leaves Holdout unexecuted and all promotion flags false',()=>{
  const r=runRegimeTrendBreakoutV1Discovery(dataset(700,{flat:true}));
  assert.equal(r.researchOnly,true);
  assert.equal(r.executionImpact,false);
  assert.equal(r.autoPromotion,false);
  assert.equal(r.holdout,null);
  assert.notEqual(r.decision,'REGIME_TREND_BREAKOUT_V1_HOLDOUT_PASS_PAPER_SHADOW_REQUIRED');
});

test('implementation workflow runs historical source/evaluation only outside pull requests',()=>{
  const y=fs.readFileSync('.github/workflows/paper-profit-regime-trend-breakout-v1.yml','utf8');
  assert.match(y,/pull_request:/);
  assert.match(y,/research\/regime-trend-breakout-v1-run/);
  assert.match(y,/PAPERBOT-PROFIT-REGIME-TREND-BREAKOUT-V1-RUN-AUTHORIZATION\.md/);
  const sourceBlock=y.slice(y.indexOf('\n  source:'),y.indexOf('\n  evaluate:'));
  const evaluateBlock=y.slice(y.indexOf('\n  evaluate:'));
  assert.match(sourceBlock,/if: github\.event_name != 'pull_request'/);
  assert.match(evaluateBlock,/if: github\.event_name != 'pull_request'/);
  const invariants=y.slice(y.indexOf('\n  invariants:'),y.indexOf('\n  source:'));
  assert.doesNotMatch(invariants,/node scripts\/collect-paper-profit-regime-trend-breakout-v1\.mjs/);
  assert.doesNotMatch(invariants,/node research\/run-paper-profit-regime-trend-breakout-v1\.mjs/);
});

test('source collector freezes an exact historical window before result inspection',()=>{
  const c=fs.readFileSync('scripts/collect-paper-profit-regime-trend-breakout-v1.mjs','utf8');
  assert.match(c,/SOURCE_START_UTC='2021-08-08T00:00:00\.000Z'/);
  assert.match(c,/SOURCE_END_UTC='2026-09-30T23:59:59\.999Z'/);
  assert.match(c,/closedBarsOnly:true/);
  assert.match(c,/privateData:false/);
  assert.match(c,/syntheticHistory:false/);
});

test('implementation path contains no Paper/live/order mutation',()=>{
  const paths=[
    'research/paper-profit-regime-trend-breakout-v1-evaluator.js',
    'scripts/collect-paper-profit-regime-trend-breakout-v1.mjs',
    'research/run-paper-profit-regime-trend-breakout-v1.mjs'
  ];
  const body=paths.map(p=>fs.readFileSync(p,'utf8')).join('\n');
  assert.doesNotMatch(body,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|liveTrading\s*=\s*true|paperTrading\s*=\s*true)/i);
});
