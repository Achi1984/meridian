import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CROSS_VENUE_FUNDING_EDGE_V2_SOURCE,
  normalizeFunding,
  normalizeMarks,
  validateCrossVenueV2Source
} from '../research/cross-venue-funding-edge-v2-data-contract.js';
import {
  validateCrossVenueV2BuilderSource,
  buildCrossVenueV2EventStream
} from '../research/cross-venue-funding-edge-v2-event-builder.js';
import {
  adaptCrossVenueV2BuilderForRunner
} from '../research/cross-venue-funding-edge-v2-runner-adapter.js';
import {
  createCrossVenueV2StrategyAdapter,
  v2LegQuantity
} from '../research/cross-venue-funding-edge-v2-strategy-adapter.js';
import {
  runCrossVenueV2StrategyDriverSynthetic,
  executeCrossVenueV2StrategyDriver
} from '../research/cross-venue-funding-edge-v2-strategy-driver.js';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

const H=60*60*1000;
const F=8*H;
const CONTRACT=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE;
const RAW_START=Date.parse(CONTRACT.rawStart);
const FUND_END=Date.parse(CONTRACT.fundingCoverageEnd);
const MARK_END=Date.parse(CONTRACT.markCoverageEnd);

function makeDraft(){
  const binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[];
  for(let t=RAW_START;t<=FUND_END;t+=F){
    binanceFunding.push({fundingTime:t,fundingRate:.0002});
    okxFunding.push({fundingTime:t,fundingRate:.0001});
  }
  for(let t=RAW_START;t<=MARK_END;t+=H){
    const row={openTime:t,open:100,high:101,low:99,close:100,confirmed:true};
    binanceMarks.push({...row});
    okxMarks.push({...row});
  }
  return{
    schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-PACKAGE-1',
    researchOnly:true,
    executionImpact:false,
    stage:'SOURCE_AUDIT',
    contract:CONTRACT,
    provenance:{
      collectedAt:'2026-01-01T00:00:00.000Z',
      binanceChecksumsVerified:true,
      okxFundingArchivesHashed:true,
      okxMarkPagesHashed:true,
      deterministicParsing:true,
      strategyPnlCalculated:false
    },
    binanceFunding,okxFunding,binanceMarks,okxMarks
  };
}
function finalize(draft){
  const validation=validateCrossVenueV2Source(draft,CONTRACT);
  assert.equal(validation.ok,true,validation.reason);
  return{...draft,integrityEvents:validation.integrityEvents,receipt:validation.receipt};
}
function cloneDraft(pkg){
  return{
    schema:pkg.schema,
    researchOnly:pkg.researchOnly,
    executionImpact:pkg.executionImpact,
    stage:pkg.stage,
    contract:CONTRACT,
    provenance:{...pkg.provenance},
    binanceFunding:pkg.binanceFunding.map(x=>({...x})),
    okxFunding:pkg.okxFunding.map(x=>({...x})),
    binanceMarks:pkg.binanceMarks.map(x=>({...x})),
    okxMarks:pkg.okxMarks.map(x=>({...x}))
  };
}
function rebuild(pkg,mutate){
  const d=cloneDraft(pkg);
  mutate?.(d);
  return finalize(d);
}
function normalized(pkg){
  return{
    binanceFunding:normalizeFunding(pkg.binanceFunding,'BINANCE',CONTRACT),
    okxFunding:normalizeFunding(pkg.okxFunding,'OKX',CONTRACT),
    binanceMarks:normalizeMarks(pkg.binanceMarks,'BINANCE'),
    okxMarks:normalizeMarks(pkg.okxMarks,'OKX')
  };
}
function validated(pkg){
  return validateCrossVenueV2BuilderSource({
    packageData:pkg,
    expectedReceiptDigest:pkg.receipt.digest
  });
}
function setActiveFunding(d,target){
  for(const time of [target-2*F,target-F,target]){
    const b=d.binanceFunding.find(x=>x.fundingTime===time);
    const o=d.okxFunding.find(x=>x.fundingTime===time);
    assert.ok(b&&o);
    b.fundingRate=.0001;
    o.fundingRate=.0026;
  }
}
function activePackage(target,extra){
  return rebuild(BASE,d=>{
    setActiveFunding(d,target);
    extra?.(d);
  });
}
function driver(pkg,split='discovery'){
  return runCrossVenueV2StrategyDriverSynthetic({
    syntheticOnly:true,
    validatedSource:validated(pkg),
    split
  });
}
function eventAt(result,kind,time){
  return result.events.find(e=>e.kind===kind&&e.time===time);
}

const BASE=finalize(makeDraft());
const TARGET=BASE.receipt.split.discovery.times[100];
const NEXT_SPLIT=BASE.receipt.split.validation.start;
const LAST_ELIGIBLE=BASE.receipt.split.discovery.times
  .filter(t=>t+26*H<NEXT_SPLIT)
  .at(-1);

test('PR2 adapter entry signal uses only causal funding history and never t+1h mark data',()=>{
  const a=activePackage(TARGET);
  const b=rebuild(a,d=>{
    const row=d.binanceMarks.find(x=>x.openTime===TARGET+H);
    assert.ok(row);
    row.open=105;row.high=106;row.low=104;row.close=105;
  });
  const aa=createCrossVenueV2StrategyAdapter({normalized:normalized(a)});
  const bb=createCrossVenueV2StrategyAdapter({normalized:normalized(b)});
  const x=aa.entryAt({decisionTime:TARGET,sourceInputsReady:true,segment:'SPLIT'});
  const y=bb.entryAt({decisionTime:TARGET,sourceInputsReady:true,segment:'SPLIT'});
  assert.deepEqual(x,y);
  assert.equal(x.entryActive,true);
  assert.equal(x.direction,1);
  assert.equal(x.signalCalculated,true);
});

test('PR2 warmup slots never calculate a strategy signal',()=>{
  const pkg=activePackage(TARGET);
  const adapter=createCrossVenueV2StrategyAdapter({normalized:normalized(pkg)});
  const x=adapter.entryAt({decisionTime:TARGET,sourceInputsReady:true,segment:'WARMUP'});
  assert.deepEqual(x,{entryActive:false,direction:null,reason:'WARMUP',signalCalculated:false});
});

test('PR2 v2LegQuantity preserves fixed notional per venue leg',()=>{
  assert.equal(v2LegQuantity(100),100);
  assert.equal(v2LegQuantity(125),80);
  assert.throws(()=>v2LegQuantity(0),/INVALID_NOTIONAL|INVALID_MARK/);
});

test('PR2 exit basis check uses only the closed h-1h candle and ignores candle h',()=>{
  const base=activePackage(TARGET);
  const futureChanged=rebuild(base,d=>{
    const row=d.okxMarks.find(x=>x.openTime===TARGET+2*H);
    assert.ok(row);row.open=105;row.high=106;row.low=104;row.close=105;
  });
  const h=TARGET+2*H;
  const a=createCrossVenueV2StrategyAdapter({normalized:normalized(base)})
    .exitAt({entryDecisionTime:TARGET,entryFillTime:TARGET+H,hour:h});
  const b=createCrossVenueV2StrategyAdapter({normalized:normalized(futureChanged)})
    .exitAt({entryDecisionTime:TARGET,entryFillTime:TARGET+H,hour:h});
  assert.deepEqual(a,b);
});

test('PR2 exit adapter trips the frozen basis risk rule on adverse closed-candle movement',()=>{
  const pkg=activePackage(TARGET,d=>{
    const b=d.binanceMarks.find(x=>x.openTime===TARGET+H);
    const o=d.okxMarks.find(x=>x.openTime===TARGET+H);
    assert.ok(b&&o);
    b.close=99;o.close=101;
  });
  const x=createCrossVenueV2StrategyAdapter({normalized:normalized(pkg)})
    .exitAt({entryDecisionTime:TARGET,entryFillTime:TARGET+H,hour:TARGET+2*H});
  assert.equal(x.exit,true);
  assert.equal(x.reason,'BASIS_RISK_LIMIT');
  assert.equal(x.heldDirection,1);
});

test('B26 sourceInputsReady true with missing decision funding is adapter integrity divergence',()=>{
  const pkg=activePackage(TARGET);
  const n=normalized(pkg);
  n.okxFunding=n.okxFunding.filter(x=>x.time!==TARGET);
  const adapter=createCrossVenueV2StrategyAdapter({normalized:n});
  assert.throws(
    ()=>adapter.entryAt({decisionTime:TARGET,sourceInputsReady:true,segment:'SPLIT'}),
    /CROSS_VENUE_V2_ADAPTER_INTEGRITY_DIVERGENCE/
  );
});

test('PR2 synthetic driver emits one causal entry/exit cycle and no PnL result',()=>{
  const pkg=activePackage(TARGET);
  const result=driver(pkg);
  assert.equal(result.syntheticOnly,true);
  assert.equal(result.strategySignalsCalculated,true);
  assert.equal(result.strategyPnlCalculated,false);
  assert.ok(eventAt(result,'ENTRY_FILL',TARGET+H));
  assert.ok(eventAt(result,'EXIT_DECISION',TARGET+8*H));
  assert.ok(eventAt(result,'EXIT_FILL',TARGET+9*H));
  assert.equal(result.counts.entryFills,1);
  assert.equal(result.counts.exitDecisions,1);
  assert.equal(result.counts.exitFills,1);
  assert.equal(result.state.status,'FLAT_ELIGIBLE');
  assert.equal(JSON.stringify(result).includes('basisPnlUsd'),false);
  assert.equal(JSON.stringify(result).includes('equityPath'),false);
});

test('B25 entry fill is emitted without inspecting the fill candle; anomaly terminalizes later',()=>{
  const pkg=activePackage(TARGET,d=>{
    d.binanceMarks=d.binanceMarks.filter(x=>x.openTime!==TARGET+H);
  });
  const result=driver(pkg);
  assert.ok(eventAt(result,'ENTRY_FILL',TARGET+H),'entry fill must be emitted unconditionally once pending');
  assert.equal(result.outcome.status,'INCONCLUSIVE');
  assert.equal(result.outcome.terminal,true);
  assert.equal(result.counts.exitFills,0);
  const terminalDetection=TARGET+2*H;
  assert.ok(result.events.every(e=>e.time<=terminalDetection));
  assert.equal(result.events.some(e=>e.kind==='COMMON_DECISION'&&e.time>terminalDetection),false);
});

test('B24 last eligible non-final decision completes inside stream boundary',()=>{
  const pkg=activePackage(LAST_ELIGIBLE);
  const source=validated(pkg);
  const built=buildCrossVenueV2EventStream({validatedSource:source,split:'discovery'});
  const result=runCrossVenueV2StrategyDriverSynthetic({
    syntheticOnly:true,validatedSource:source,split:'discovery'
  });
  const streamEnd=Date.parse(built.stream.streamEnd);
  assert.ok(eventAt(result,'ENTRY_FILL',LAST_ELIGIBLE+H));
  assert.ok(result.counts.exitFills>=1);
  assert.ok(Math.max(...result.events.map(e=>e.time))<=streamEnd);
  assert.ok(['FLAT_ELIGIBLE','DEGRADED_FLAT','TERMINAL_INCONCLUSIVE'].includes(result.state.status));
});

test('B23 production driver remains locked at SOURCE_AUDIT',()=>{
  assert.equal(CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK.discovery,false);
  assert.throws(
    ()=>executeCrossVenueV2StrategyDriver({lock:CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK}),
    /CROSS_VENUE_V2_DISCOVERY_LOCKED/
  );
});

test('PR2 synthetic driver requires an explicit syntheticOnly flag',()=>{
  const pkg=activePackage(TARGET);
  assert.throws(
    ()=>runCrossVenueV2StrategyDriverSynthetic({validatedSource:validated(pkg),split:'discovery'}),
    /CROSS_VENUE_V2_SYNTHETIC_DRIVER_FLAG_REQUIRED/
  );
});

test('B31 driver binds to the exact builder stream and recovery-input digest',()=>{
  const pkg=activePackage(TARGET);
  const source=validated(pkg);
  const built=buildCrossVenueV2EventStream({validatedSource:source,split:'discovery'});
  const result=runCrossVenueV2StrategyDriverSynthetic({
    syntheticOnly:true,validatedSource:source,split:'discovery'
  });
  const structural=adaptCrossVenueV2BuilderForRunner({builderOutput:built});
  assert.equal(result.sourceBinding.receiptDigest,structural.sourceReceiptDigest);
  assert.equal(result.sourceBinding.streamDigest,structural.sourceStreamDigest);
  assert.equal(result.sourceBinding.packageBoundDigest,structural.sourcePackageBoundDigest);
  assert.equal(result.sourceBinding.recoveryInputsDigest,structural.stream.recoveryInputsDigest);
  assert.equal(result.structuralAdapterSchema,structural.schema);
});

test('B28 degradation remains runner-owned; builder is the only entryInputsReady caller and pins activeDegradation false',()=>{
  const builder=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-event-builder.js',import.meta.url),'utf8');
  const adapter=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-strategy-adapter.js',import.meta.url),'utf8');
  const driver=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-strategy-driver.js',import.meta.url),'utf8');
  assert.match(builder,/entryInputsReady\(\{[\s\S]*?activeDegradation:false/);
  assert.doesNotMatch(adapter,/entryInputsReady\s*\(/);
  assert.doesNotMatch(driver,/entryInputsReady\s*\(/);
  assert.doesNotMatch(driver,/recoveryEligible/);
});

test('PR2 modules are pure/research-only and never read canonical source data or artifacts',()=>{
  for(const file of [
    '../research/cross-venue-funding-edge-v2-strategy-adapter.js',
    '../research/cross-venue-funding-edge-v2-strategy-driver.js'
  ]){
    const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/research\/data|artifact|api\.github\.com|\bfetch\s*\(|child_process|from ['"]node:fs['"]/i);
  }
});

test('PR2 driver delegates structural runner mapping and lineage to the reviewed runner adapter',()=>{
  const driver=fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-strategy-driver.js',import.meta.url),'utf8');
  assert.match(driver,/adaptCrossVenueV2BuilderForRunner\s*\(/);
  assert.doesNotMatch(driver,/function\s+runnerDecisionFromSlot/);
  assert.doesNotMatch(driver,/COMMON_DECISION_SLOT['"]\)\s*\{\s*return\s+Object\.freeze/);
});

test('PR2 terminal entry-candle failure prevents later decision exposure',()=>{
  const pkg=activePackage(TARGET,d=>{
    d.binanceMarks=d.binanceMarks.filter(x=>x.openTime!==TARGET+H);
    setActiveFunding(d,TARGET+4*F);
  });
  const result=driver(pkg);
  const terminalDetection=TARGET+2*H;
  assert.equal(result.outcome.terminal,true);
  assert.ok(result.events.every(e=>e.time<=terminalDetection));
  assert.equal(result.events.some(e=>e.kind==='COMMON_DECISION'&&e.time>TARGET),false);
});

