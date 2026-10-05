import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_CONFIG as cfg,
  strictNum,costBreakdown,fundingSpread,conservativeProjection,entryDecision,
  remainingFundingIntervals,exitDecision,fundingCashflow,basisPnl,directionLegs,
  positionOpenAtDetection,degradationOutcome,assertV2StageAdvanceAllowed,
  reconcileCycleAccounting,tradePathDigest,scenarioPathIdentity
} from '../research/cross-venue-funding-edge-v2.js';

const BAD=[null,'','  ',false,true,[],NaN];

test('strictNum accepts decimal numeric strings but rejects coercible non-numeric values',()=>{
  assert.equal(strictNum('0.0001'),0.0001);
  assert.equal(strictNum('0'),0);
  assert.equal(strictNum('-1.2e-3'),-0.0012);
  for(const x of BAD)assert.ok(Number.isNaN(strictNum(x)),String(x));
});

test('V2 economics preserve the frozen V1 cost model and stress changes only slippage',()=>{
  const b=costBreakdown('baseline'),s=costBreakdown('stress');
  assert.equal(b.roundTripBps,37);
  assert.equal(b.roundTripUsd,37);
  assert.equal(b.closeBps,16);
  assert.equal(b.closeUsd,16);
  assert.equal(b.entryHurdleUsd,55.5);
  assert.equal(b.closeHurdleUsd,24);
  assert.equal(s.roundTripBps,49);
  assert.equal(b.feeBps,s.feeBps);
  assert.equal(b.operationalBufferBps,s.operationalBufferBps);
  assert.equal(b.notionalPerLeg,s.notionalPerLeg);
  assert.equal(b.fills,s.fills);
  assert.equal(b.slippageBpsPerFill,3);
  assert.equal(s.slippageBpsPerFill,6);
});

test('funding spread rejects every coercible bad scalar before arithmetic',()=>{
  assert.ok(Math.abs(fundingSpread(.0001,.0003)-.0002)<1e-15);
  for(const bad of BAD){
    assert.throws(()=>fundingSpread(bad,.001),/INVALID_FUNDING_RATE/);
    assert.throws(()=>fundingSpread(.001,bad),/INVALID_FUNDING_RATE/);
  }
});

test('projection treats bad spread values as data-integrity failure, not an economic signal',()=>{
  assert.equal(conservativeProjection([.001,.002,.0015]).valid,true);
  assert.equal(conservativeProjection([.001,.002]).reason,'INSUFFICIENT_SPREAD_HISTORY');
  assert.equal(conservativeProjection([.001,-.002,.001]).reason,'SPREAD_NOT_PERSISTENT');
  for(const bad of BAD){
    const p=conservativeProjection([.001,.002,bad]);
    assert.equal(p.valid,false);
    assert.equal(p.reason,'DATA_INTEGRITY_FAILURE');
    assert.equal(p.inconclusive,true);
    const e=entryDecision([.001,.002,bad]);
    assert.equal(e.active,false);
    assert.equal(e.inconclusive,true);
  }
});

test('exitDecision classifies invalid accounting inputs as INCONCLUSIVE',()=>{
  const base={heldDirection:1,spreads:[.003,.003,.003],remainingHours:16,basisPnlUsd:0};
  assert.equal(exitDecision(base).exit,false);
  assert.equal(exitDecision({...base,heldDirection:'1'}).inconclusive,true);
  assert.equal(exitDecision({...base,basisPnlUsd:null}).inconclusive,true);
  assert.equal(exitDecision({...base,remainingHours:null}).inconclusive,true);
  assert.equal(exitDecision({...base,spreads:[.003,.003,null]}).inconclusive,true);
  assert.equal(exitDecision({...base,integrityOk:false}).inconclusive,true);
  assert.equal(exitDecision({...base,remainingHours:0}).reason,'MAX_HOLDING_HORIZON');
  assert.equal(exitDecision({...base,basisPnlUsd:-101}).reason,'BASIS_RISK_LIMIT');
});

test('remaining funding interval math rejects invalid values instead of coercing them',()=>{
  assert.equal(remainingFundingIntervals(16),2);
  assert.equal(remainingFundingIntervals(0),0);
  for(const bad of BAD)assert.throws(()=>remainingFundingIntervals(bad),/INVALID_REMAINING_HOURS/);
});

test('fundingCashflow rejects bad qty mark rate values and preserves venue-side sign',()=>{
  assert.equal(fundingCashflow({side:'LONG',qty:1,mark:10000,rate:.001}),-10);
  assert.equal(fundingCashflow({side:'SHORT',qty:1,mark:10000,rate:.001}),10);
  assert.equal(fundingCashflow({side:'LONG',qty:1,mark:10000,rate:0}),0);
  for(const field of ['qty','mark','rate']){
    for(const bad of BAD){
      const x={side:'LONG',qty:1,mark:10000,rate:.001};x[field]=bad;
      assert.throws(()=>fundingCashflow(x),/INVALID_FUNDING_CASHFLOW/);
    }
  }
});

test('basisPnl never invents money from missing or coercible values',()=>{
  const good={binanceSide:'LONG',binanceQty:1,binanceEntry:100,binanceMark:110,okxSide:'SHORT',okxQty:1,okxEntry:101,okxMark:108};
  assert.equal(basisPnl(good),3);
  for(const field of ['binanceQty','binanceEntry','binanceMark','okxQty','okxEntry','okxMark']){
    for(const bad of BAD){
      const x={...good,[field]:bad};
      assert.throws(()=>basisPnl(x),/INVALID_BASIS_INPUT/);
    }
  }
  assert.throws(()=>basisPnl({...good,binanceEntry:null}),/INVALID_BASIS_INPUT/);
});

test('direction is type-strict and cannot accept string 1',()=>{
  assert.deepEqual(directionLegs(1),{binance:'LONG',okx:'SHORT'});
  assert.deepEqual(directionLegs(-1),{binance:'SHORT',okx:'LONG'});
  assert.throws(()=>directionLegs('1'),/INVALID_DIRECTION/);
});

test('degradation tie-break treats entry or exit at the detection timestamp as position-open',()=>{
  const t=Date.parse('2026-01-01T00:00:00Z');
  assert.equal(positionOpenAtDetection({entryFillTime:t,detectionTime:t}),true);
  assert.equal(positionOpenAtDetection({entryFillTime:t-H,detectionTime:t,exitFillTime:t}),true);
  assert.equal(positionOpenAtDetection({entryFillTime:t-H,detectionTime:t,exitFillTime:t-1}),false);
});

test('open-position degradation is terminal INCONCLUSIVE and cannot advance',()=>{
  const o=degradationOutcome({positionOpenAtDetection:true});
  assert.equal(o.status,'INCONCLUSIVE');
  assert.equal(o.terminal,true);
  assert.equal(o.mayAdvance,false);
  assert.throws(()=>assertV2StageAdvanceAllowed(o),/INCONCLUSIVE_TERMINAL/);
  const flat=degradationOutcome({positionOpenAtDetection:false});
  assert.equal(flat.status,'DATA_DEGRADED');
  assert.equal(flat.terminal,false);
  assert.throws(()=>assertV2StageAdvanceAllowed(flat),/STAGE_ADVANCE_BLOCKED/);
  assert.equal(assertV2StageAdvanceAllowed({status:'PASS',terminal:false,mayAdvance:true}),true);
});

test('cycle accounting reconciles funding plus basis minus costs to equity delta',()=>{
  const r=reconcileCycleAccounting({
    fundingCashflows:[10,-2,5],
    basisPnlUsd:7,
    costsUsd:4,
    openingEquity:20000,
    closingEquity:20016
  });
  assert.equal(r.fundingUsd,13);
  assert.equal(r.expectedDelta,16);
  assert.equal(r.actualDelta,16);
  assert.equal(r.ok,true);
  assert.throws(()=>reconcileCycleAccounting({
    fundingCashflows:[10,-2,5],
    basisPnlUsd:7,
    costsUsd:4,
    openingEquity:20000,
    closingEquity:20015
  }),/ACCOUNTING_RECONCILIATION/);
});

const H=60*60*1000;

test('frozen V2 config remains BTC-only and leverage-neutral',()=>{
  assert.equal(cfg.symbol,'BTCUSDT');
  assert.equal(cfg.venues.binance,'BINANCE_USDM');
  assert.equal(cfg.venues.okx,'OKX_USDT_SWAP');
  assert.equal(cfg.notionalPerLeg,10000);
  assert.equal(cfg.reservedCapital,20000);
  assert.equal(cfg.maxHoldingHours,24);
  assert.equal(cfg.fundingIntervalMs,8*H);
});


test('baseline and stress scenarios preserve an identical trade path identity',()=>{
  const path=[
    {venue:'BINANCE',side:'LONG',time:1760000000000,qty:.1,mark:100000},
    {venue:'OKX',side:'SHORT',time:1760000000000,qty:.1,mark:100010},
    {venue:'BINANCE',side:'LONG',time:1760086400000,qty:.1,mark:100500},
    {venue:'OKX',side:'SHORT',time:1760086400000,qty:.1,mark:100490}
  ];
  const digest=tradePathDigest(path);
  const base=scenarioPathIdentity(path,'baseline');
  const stress=scenarioPathIdentity(path,'stress');
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(base.tradePathDigest,digest);
  assert.equal(stress.tradePathDigest,digest);
  assert.equal(base.slippageBpsPerFill,3);
  assert.equal(stress.slippageBpsPerFill,6);
});
