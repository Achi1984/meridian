import test from 'node:test';
import assert from 'node:assert/strict';
import {
  observationsFromSignal,
  cohortEvidence,
  evaluateAdaptiveEvidence,
  summarizeMarketCapture
} from '../adaptive-evidence.js';

const signal=(extra={})=>({
  symbol:'BTCUSDT',side:'LONG',regime:'RANGE',status:'READY',
  frames:{
    '15m':{price:100,ema20:99,ema50:98,rsi:60,macd:{hist:1},atr:1.5,volumeRatio:1.5},
    '1h':{price:100,ema20:99,ema50:98,macd:{hist:1}},
    '4h':{price:100,ema20:99,ema50:98,macd:{hist:1}}
  },
  ...extra
});

test('observations are side-aware and derived from raw frames',()=>{
  const o=observationsFromSignal(signal());
  assert.equal(o.side,'LONG');
  assert.equal(o.regime,'RANGE');
  assert.equal(o.mtfAlignment,'3');
  assert.equal(o.momentum,'STRONG');
  assert.equal(o.volume,'HIGH');
  assert.equal(o.volatility,'NORMAL');
  assert.equal(o.asset,'BTCUSDT');
});

test('small samples are shrunk strongly and cannot create a large edge',()=>{
  const tiny=cohortEvidence({n:3,avgR:1.2,windows:[1.0,1.1]});
  const mature=cohortEvidence({n:120,avgR:1.2,windows:[1.0,1.1,1.3]});
  assert.ok(Math.abs(tiny.edgeR)<Math.abs(mature.edgeR));
  assert.ok(tiny.reliability<mature.reliability);
});

test('adaptive evaluator has no built-in LONG plus RANGE bonus',()=>{
  const r=evaluateAdaptiveEvidence(signal(),{});
  assert.equal(r.edgeR,0);
  assert.equal(r.confidence,50);
  assert.equal(r.decision,'OBSERVE');
  assert.equal(r.components.length,0);
});

test('context evidence can support a trade only through learned cohorts',()=>{
  const map={
    side:{LONG:{n:80,avgR:.25,windows:[.2,.3,.1]}},
    regime:{'LONG|RANGE':{n:70,avgR:.3,windows:[.2,.4,.25]}},
    mtfAlignment:{'LONG|3':{n:60,avgR:.22,windows:[.1,.3,.2]}}
  };
  const r=evaluateAdaptiveEvidence(signal(),map);
  assert.equal(r.decision,'TRADE');
  assert.ok(r.edgeR>.12);
  assert.ok(r.reliability>.5);
});

test('negative learned context remains soft evidence and can return SKIP',()=>{
  const map={
    regime:{'LONG|RANGE':{n:100,avgR:-.4,windows:[-.3,-.5,-.35]}},
    momentum:{'LONG|STRONG':{n:80,avgR:-.2,windows:[-.1,-.25,-.2]}}
  };
  const r=evaluateAdaptiveEvidence(signal(),map);
  assert.equal(r.decision,'SKIP');
  assert.ok(r.edgeR<-.08);
  assert.equal(r.researchOnly,true);
});

test('market capture exposes coverage, missed winners, avoided losers and net opportunity cost',()=>{
  const s=summarizeMarketCapture([
    {traded:true,counterfactualR:1.5,realizedR:1.0},
    {traded:false,counterfactualR:2.0,realizedR:0},
    {traded:false,counterfactualR:-1.0,realizedR:0},
    {traded:true,counterfactualR:-1.0,realizedR:-1.0}
  ]);
  assert.equal(s.opportunities,4);
  assert.equal(s.coveragePct,50);
  assert.equal(s.missedWinnerR,2);
  assert.equal(s.avoidedLoserR,1);
  assert.equal(s.opportunityCostR,1);
  assert.equal(s.marketCapturePct,28.57);
});
