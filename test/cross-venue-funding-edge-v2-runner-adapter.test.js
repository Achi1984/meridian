import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptCrossVenueV2BuilderForRunner} from '../research/cross-venue-funding-edge-v2-runner-adapter.js';
import {runnerEventKey,runV2RunnerStateMachine} from '../research/cross-venue-funding-edge-v2-runner.js';

function builder(events){
  return {
    schema:'CROSS-VENUE-FUNDING-EDGE-V2-EVENT-BUILDER-1',
    researchOnly:true,executionImpact:false,
    strategyPnlCalculated:false,strategySignalsCalculated:false,
    streamDigest:'a'.repeat(64),packageBoundDigest:'b'.repeat(64),events
  };
}
const T=Date.parse('2024-01-01T00:00:00Z');

test('PR2 adapter converts structural slots to runner-valid no-entry decisions',()=>{
  const out=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([
    {time:T,kind:'FUNDING_SETTLEMENT',venue:'BINANCE',stableId:'fs-b'},
    {time:T,kind:'FUNDING_SETTLEMENT',venue:'OKX',stableId:'fs-o'},
    {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}
  ])});
  assert.equal(out.strategySignalsCalculated,false);
  assert.equal(out.strategyPnlCalculated,false);
  const decision=out.events.find(e=>e.kind==='COMMON_DECISION');
  assert.deepEqual(decision,{
    time:T,kind:'COMMON_DECISION',venue:'',stableId:'cd',
    entryActive:false,inputsReady:true,splitEligible:true
  });
  assert.doesNotThrow(()=>out.events.forEach(runnerEventKey));
  const run=runV2RunnerStateMachine(out.events,{finalize:false});
  assert.equal(run.state.status,'FLAT_ELIGIBLE');
  assert.equal(run.state.pendingEntry,null);
});

test('PR2 adapter preserves runner tie order: integrity before common decision',()=>{
  const out=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([
    {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true},
    {time:T,kind:'INTEGRITY_DETECTION',venue:'OKX',stableId:'id',integrityKind:'MISSING_MARK'}
  ])});
  assert.deepEqual(out.events.map(e=>e.kind),['INTEGRITY_DETECTION','COMMON_DECISION']);
});

test('PR2 adapter is permutation invariant under runner ordering',()=>{
  const events=[
    {time:T+1,kind:'INTEGRITY_DETECTION',venue:'OKX',stableId:'id',integrityKind:'MISSING_MARK'},
    {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:false,splitEligible:true},
    {time:T,kind:'FUNDING_SETTLEMENT',venue:'BINANCE',stableId:'fs'}
  ];
  const a=adaptCrossVenueV2BuilderForRunner({builderOutput:builder(events)});
  const b=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([...events].reverse())});
  assert.deepEqual(a.events,b.events);
});

test('PR2 adapter rejects unknown builder kinds and unsafe builder flags',()=>{
  assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:builder([
    {time:T,kind:'ENTRY_FILL',venue:'BINANCE',stableId:'x'}
  ])}),/UNEXPECTED_BUILDER_KIND/);
  assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:{
    ...builder([]),strategySignalsCalculated:true
  }}),/BUILDER_FLAGS/);
});

test('PR2 adapter cannot create strategy signal, fill, exit decision or PnL fields',()=>{
  const out=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([
    {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}
  ])});
  const text=JSON.stringify(out);
  assert.equal(text.includes('"entryActive":true'),false);
  assert.equal(text.includes('"ENTRY_FILL"'),false);
  assert.equal(text.includes('"EXIT_FILL"'),false);
  assert.equal(text.includes('"EXIT_DECISION"'),false);
  for(const forbidden of ['"fundingRate"','"price"','"spread"','"direction"','"basis"','"equity"'])
    assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
});
