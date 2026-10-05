import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {adaptCrossVenueV2BuilderForRunner} from '../research/cross-venue-funding-edge-v2-runner-adapter.js';
import {runnerEventKey,runV2RunnerStateMachine} from '../research/cross-venue-funding-edge-v2-runner.js';

function canon(x){if(Array.isArray(x))return x.map(canon);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])]));return x}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(canon(x))).digest('hex')}
function builder(events,{split='discovery'}={}){
  const base={schema:'CROSS-VENUE-FUNDING-EDGE-V2-EVENT-BUILDER-1',ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',
    researchOnly:true,executionImpact:false,strategyPnlCalculated:false,strategySignalsCalculated:false,
    sourceBinding:{contractSchema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-1',receiptDigest:'c'.repeat(64)},
    stream:{split,streamEnd:'2024-01-01T00:00:00.000Z',recoveryInputsDigest:'d'.repeat(64)},
    events,counts:{fundingSettlements:events.filter(e=>e.kind==='FUNDING_SETTLEMENT').length,
      integrityDetections:events.filter(e=>e.kind==='INTEGRITY_DETECTION').length,
      slots:events.filter(e=>e.kind==='COMMON_DECISION_SLOT').length,splitSlots:0,splitEligibleSlots:0}};
  const causal={schema:base.schema,ruleset:base.ruleset,researchOnly:true,executionImpact:false,
    strategyPnlCalculated:false,strategySignalsCalculated:false,contractSchema:base.sourceBinding.contractSchema,
    stream:base.stream,events:base.events,counts:base.counts};
  base.streamDigest=hash(causal);
  base.packageBoundDigest=hash({...base});
  return base;
}
const T=Date.parse('2024-01-01T00:00:00Z');

test('PR2 converts verified structural slots to runner-valid no-entry decisions',()=>{
 const input=builder([{time:T,kind:'FUNDING_SETTLEMENT',venue:'BINANCE',stableId:'fs'},
  {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}]);
 const out=adaptCrossVenueV2BuilderForRunner({builderOutput:input});
 const d=out.events.find(e=>e.kind==='COMMON_DECISION');
 assert.deepEqual(d,{time:T,kind:'COMMON_DECISION',venue:'',stableId:'cd',entryActive:false,inputsReady:true,splitEligible:true});
 assert.equal(out.sourceStreamDigest,input.streamDigest);assert.equal(out.sourcePackageBoundDigest,input.packageBoundDigest);
 assert.equal(out.sourceReceiptDigest,input.sourceBinding.receiptDigest);assert.deepEqual(out.stream,input.stream);
 assert.doesNotThrow(()=>out.events.forEach(runnerEventKey));
 const run=runV2RunnerStateMachine(out.events,{finalize:false});
 assert.equal(run.state.status,'FLAT_ELIGIBLE');assert.equal(run.state.pendingEntry,null);
});

test('PR2 preserves runner tie order and is permutation invariant when source is valid',()=>{
 const aEvents=[{time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true},
  {time:T,kind:'INTEGRITY_DETECTION',venue:'OKX',stableId:'id',integrityKind:'MISSING_MARK'}];
 const a=adaptCrossVenueV2BuilderForRunner({builderOutput:builder(aEvents)});
 const b=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([...aEvents].reverse())});
 assert.deepEqual(a.events.map(e=>e.kind),['INTEGRITY_DETECTION','COMMON_DECISION']);
 assert.deepEqual(a.events,b.events);
});

test('PR2 fails closed on every builder mutation without digest regeneration',()=>{
 const original=builder([{time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}]);
 const mutations=[
  x=>x.events[0].splitEligible=false,
  x=>x.events[0].sourceInputsReady=false,
  x=>x.events[0].time++,
  x=>x.events[0].venue='FOO',
  x=>x.events.push({time:T+1,kind:'INTEGRITY_DETECTION',venue:'FOO',stableId:'x',integrityKind:'WHATEVER'}),
  x=>x.events.pop(),
  x=>x.stream.split='validation',
  x=>x.stream.recoveryInputsDigest='e'.repeat(64),
  x=>x.sourceBinding.receiptDigest='e'.repeat(64)
 ];
 for(const mutate of mutations){const x=structuredClone(original);mutate(x);assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:x}),/DIGEST_MISMATCH/)}
});

test('PR2 rejects swapped split digest, extra top-level keys, unsafe flags and unknown kinds',()=>{
 const discovery=builder([{time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}]);
 const validation=builder(discovery.events,{split:'validation'});
 assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:{...discovery,streamDigest:validation.streamDigest}}),/DIGEST_MISMATCH/);
 assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:{...discovery,extra:true}}),/BUILDER_KEYS/);
 assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:{...discovery,strategySignalsCalculated:true}}),/BUILDER_FLAGS|DIGEST/);
 const unknown=builder([{time:T,kind:'ENTRY_FILL',venue:'BINANCE',stableId:'x'}]);
 assert.throws(()=>adaptCrossVenueV2BuilderForRunner({builderOutput:unknown}),/UNEXPECTED_BUILDER_KIND/);
});

test('PR2 cannot create strategy signal, fill, exit decision or PnL payload',()=>{
 const out=adaptCrossVenueV2BuilderForRunner({builderOutput:builder([
  {time:T,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd',sourceInputsReady:true,splitEligible:true}])});
 const text=JSON.stringify(out);
 for(const forbidden of ['"entryActive":true','"ENTRY_FILL"','"EXIT_FILL"','"EXIT_DECISION"','"fundingRate"','"price"','"spread"','"direction"','"basis"','"equity"'])
  assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()),false,forbidden);
});

test('PR2 degradation and recovery decisions never create pending entry',()=>{
 const events=[
  {time:T,kind:'INTEGRITY_DETECTION',venue:'OKX',stableId:'bad',integrityKind:'MISSING_MARK'},
  ...[1,2,3].map(i=>({time:T+i*8*60*60*1000,kind:'COMMON_DECISION_SLOT',venue:'',stableId:'cd'+i,sourceInputsReady:true,splitEligible:true}))
 ];
 const out=adaptCrossVenueV2BuilderForRunner({builderOutput:builder(events)});
 assert.ok(out.events.filter(e=>e.kind==='COMMON_DECISION').every(e=>e.entryActive===false));
});
