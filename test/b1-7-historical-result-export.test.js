import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalHistoricalExportPayload,parseArenaHistoricalExport,MAX_HISTORICAL_EXPORT_BYTES
} from '../v11/arena-historical-export.js';
import {createSyntheticSeries} from '../test/fixtures/b1-7/synthetic-series.mjs';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {
  createInsufficientEvidenceProfile,createInsufficientEvidenceSeries
} from '../scripts/research-supervisor/test_b1_generated_fixture.mjs';
import {createStrategyArenaView} from '../v11/strategy-arena.js';
import {canonicalJson} from '../scripts/research/b1-7/engine.mjs';
import {
  digest,generatedEnvelope,generatedObservation,generatedResult,seal
} from '../test/fixtures/b1-7/historical-export.mjs';

test('synthetic generated completed and insufficient results round-trip with exact producer bytes',async()=>{
  const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
  const insufficientProfile=createInsufficientEvidenceProfile();
  const insufficientResult=generatedResult(insufficientProfile,createInsufficientEvidenceSeries());
  assert.equal(completedResult.status,'COMPLETED');
  assert.equal(insufficientResult.status,'INSUFFICIENT_EVIDENCE');
  const completed=await generatedEnvelope(bridgeManifest,completedResult,'completed','trial-m11-synthetic-completed');
  const insufficient=await generatedEnvelope(insufficientProfile,insufficientResult,'failed','trial-m11-synthetic-insufficient');
  for(const [envelope,status,count,resultSha,summarySha,payloadSha] of [
    [completed,'COMPLETED',44,'1f2d4d889bc6bbf320f0cef229754b7058860c125c167af1c4cb0c711884f863',
      'd73738b521b6b8cbc8cfe198b85e573c197a985bb5c5956be7544d3e82b2ea03',
      '0e904f0e6d6287edec237a412b4519d459d17f4132bf77b4ce0c1bffe02bea04'],
    [insufficient,'INSUFFICIENT_EVIDENCE',19,'640b2603bb265607d75b704b4f6722d1553d3f21b5bb1c67c623a9ba50a4205d',
      'c9fd86ab19e0e7fd42a80aa8dc9c02742d749644b356ddb0a1e6a1b905c94f83',
      '7e1332df258eecb0fb9c559d05f9ec4ba38bf7cd604acebc7bb729d2fe403f2a']
  ]){
    assert.equal(envelope.job.sourceSha256,digest(canonicalJson(bridgeManifest.sourceSha256)));
    const sourceBytes=new TextEncoder().encode(envelope.job.result);
    const imported=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(envelope)));
    assert.equal(imported.status,'PRESENT_UNVERIFIED');
    assert.equal(imported.job.resultSha256,resultSha);
    assert.equal(imported.job.summarySha256,summarySha);
    assert.equal(imported.job.resultSha256,digest(sourceBytes));
    assert.equal(envelope.payloadSha256,payloadSha);
    assert.equal(imported.result.status,status);
    assert.equal(imported.result.completedPaths,count);
    assert.equal(imported.job.paths.length,count);
    assert.equal(imported.provenance.sourceAuthenticity,'NOT_ESTABLISHED');
    assert.equal(imported.provenance.syntheticFixture,true);
    assert.equal(imported.job.pathIds.length,44);
    assert.equal(imported.job.computationPathIds[0],imported.job.pathIds[0]);
    assert.notDeepEqual(imported.job.pathIds,imported.job.computationPathIds);
    assert.ok(sourceBytes.length<1024*1024);
  }
  assert.equal(digest(canonicalJson(bridgeManifest.sourceSha256)),
    'bab379ce692601315ef3b0436ac7969798e96cc9781f7f3845ec4ed8a2b770e7');
  assert.equal(Buffer.byteLength(completed.job.result),939389);
  assert.equal(Buffer.byteLength(insufficient.job.result),207285);
});

test('synthetic producer bindings reject resealed historical screen verdicts',async()=>{
  const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
  const completed=await generatedEnvelope(bridgeManifest,completedResult,'completed','trial-m11-screen-binding');
  const accepted=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(completed)));
  assert.equal(accepted.status,'PRESENT_UNVERIFIED');
  const staleSourceBinding=structuredClone(completed);
  staleSourceBinding.job.sourceSha256='64de87409d07004c7a8ab1a17e0ac7ce0c85a259e978c689745f907c9c55ea05';
  await seal(staleSourceBinding);
  assert.equal((await parseArenaHistoricalExport(
    new TextEncoder().encode(JSON.stringify(staleSourceBinding))
  )).status,'INVALID');
  for(const [status,interpretation] of [
    ['PASS','HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT'],
    ['NO_EDGE','HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT'],
    ['SYNTHETIC_ONLY_NOT_ASSESSED','HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT']
  ]){
    const changed=structuredClone(completed);
    const result=JSON.parse(changed.job.result);
    result.screen.status=status;
    result.screen.interpretation=interpretation;
    changed.job.result=canonicalJson(result);
    changed.job.resultSha256=digest(changed.job.result);
    await seal(changed);
    assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(changed)))).status,
      'INVALID',`${status}/${interpretation}`);
  }
  const completedWithInsufficientScreen=structuredClone(completed);
  const completedNested=JSON.parse(completedWithInsufficientScreen.job.result);
  completedNested.screen={status:'INSUFFICIENT_EVIDENCE',
    checks:{fullBasketDrawdownDenominator:false},relativeDrawdownReduction:null};
  completedWithInsufficientScreen.job.result=canonicalJson(completedNested);
  completedWithInsufficientScreen.job.resultSha256=digest(completedWithInsufficientScreen.job.result);
  await seal(completedWithInsufficientScreen);
  assert.equal((await parseArenaHistoricalExport(
    new TextEncoder().encode(JSON.stringify(completedWithInsufficientScreen))
  )).status,'INVALID');

  const insufficientProfile=createInsufficientEvidenceProfile();
  const insufficientResult=generatedResult(insufficientProfile,createInsufficientEvidenceSeries());
  const insufficient=await generatedEnvelope(
    insufficientProfile,insufficientResult,'failed','trial-m11-screen-binding-insufficient'
  );
  const acceptedInsufficient=await parseArenaHistoricalExport(
    new TextEncoder().encode(JSON.stringify(insufficient))
  );
  assert.equal(acceptedInsufficient.status,'PRESENT_UNVERIFIED');
  assert.equal(acceptedInsufficient.result.status,'INSUFFICIENT_EVIDENCE');
  const historicalInsufficient=structuredClone(insufficient);
  const insufficientNested=JSON.parse(historicalInsufficient.job.result);
  insufficientNested.screen.interpretation='HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT';
  historicalInsufficient.job.result=canonicalJson(insufficientNested);
  historicalInsufficient.job.resultSha256=digest(historicalInsufficient.job.result);
  await seal(historicalInsufficient);
  assert.equal((await parseArenaHistoricalExport(
    new TextEncoder().encode(JSON.stringify(historicalInsufficient))
  )).status,'INVALID');
});

test('generated export import displays exact statuses, zero, false and missing metrics, then clears stale data',async()=>{
  const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
  const insufficientProfile=createInsufficientEvidenceProfile();
  const insufficientResult=generatedResult(insufficientProfile,createInsufficientEvidenceSeries());
  const completed=await generatedEnvelope(bridgeManifest,completedResult,'completed','trial-m11-synthetic-completed');
  const insufficient=await generatedEnvelope(insufficientProfile,insufficientResult,'failed','trial-m11-synthetic-insufficient');
  const listeners=new Map();
  const root={
    innerHTML:'',
    contains:()=>true,
    addEventListener:(name,handler)=>listeners.set(name,handler),
    removeEventListener:name=>listeners.delete(name),
    replaceChildren(){this.innerHTML='';},
    importExport(bytes){
      const file={size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer};
      return listeners.get('change')({type:'change',target:{
        closest:selector=>selector==='[data-arena-historical-export]'?{files:[file]}:null
      }});
    }
  };
  const view=createStrategyArenaView(root);
  await root.importExport(new TextEncoder().encode(JSON.stringify(completed)));
  assert.match(root.innerHTML,/class="arena-result-workspace"/);
  assert.match(root.innerHTML,/SYNTHETIC_ONLY · UNVERIFIED · Herkunft nicht bestätigt/);
  assert.match(root.innerHTML,/CALLER_SUPPLIED_INSPECT_B1/);
  assert.match(root.innerHTML,/Lifecycle completed/);
  assert.match(root.innerHTML,/<dt>Engine-Ergebnis<\/dt><dd>COMPLETED<\/dd>/);
  assert.match(root.innerHTML,/<dt>Screen<\/dt><dd>SYNTHETIC_ONLY_NOT_ASSESSED<\/dd>/);
  assert.match(root.innerHTML,/<th scope="row">Cash<\/th><td>COMPLETED<\/td><td>0<\/td><td>0<\/td>/);
  assert.match(root.innerHTML,/<dt>executionAuthorized · Caller-Assertion<\/dt><dd>false<\/dd>/);
  await root.importExport(new TextEncoder().encode(JSON.stringify(insufficient)));
  assert.match(root.innerHTML,/Lifecycle failed/);
  assert.match(root.innerHTML,/<dt>Ergebnisse abgeschlossen<\/dt><dd>19<\/dd>/);
  assert.match(root.innerHTML,/<dt>Pfade geplant<\/dt><dd>44<\/dd>/);
  assert.match(root.innerHTML,/<dt>Screen<\/dt><dd>INSUFFICIENT_EVIDENCE<\/dd>/);
  assert.match(root.innerHTML,/<td>NOT_RUN_INSUFFICIENT_EVIDENCE<\/td><td>Nicht verfügbar<\/td>/);
  await root.importExport(new TextEncoder().encode(JSON.stringify({...completed,payloadSha256:'0'.repeat(64)})));
  assert.match(root.innerHTML,/role="alert"/);
  assert.doesNotMatch(root.innerHTML,/COMPLETED|Lifecycle failed/);
  view.dispose();
});

test('producer import clears read errors and stale async results, and disposal suppresses late paints',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const envelope=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-race');
  const bytes=new TextEncoder().encode(JSON.stringify(envelope));
  const listeners=new Map();
  const root={
    innerHTML:'',
    contains:()=>true,
    addEventListener:(name,handler)=>listeners.set(name,handler),
    removeEventListener:name=>listeners.delete(name),
    replaceChildren(){this.innerHTML='';}
  };
  const view=createStrategyArenaView(root);
  const dispatch=file=>listeners.get('change')({type:'change',target:{
    closest:selector=>selector==='[data-arena-historical-export]'?{files:[file]}:null
  }});
  const regularFile={size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};
  await dispatch(regularFile);
  assert.match(root.innerHTML,/<dt>Engine-Ergebnis<\/dt><dd>COMPLETED<\/dd>/);
  let finishSlow;
  const slowFile={size:bytes.length,arrayBuffer:()=>new Promise(resolve=>{finishSlow=resolve;})};
  const slowImport=dispatch(slowFile);
  const failedImport=dispatch({size:2,arrayBuffer:async()=>new TextEncoder().encode('{}').buffer});
  await failedImport;
  assert.match(root.innerHTML,/role="alert"/);
  assert.doesNotMatch(root.innerHTML,/Engine-Ergebnis<\/dt><dd>COMPLETED|Lifecycle<\/dt><dd>completed/);
  finishSlow(bytes.slice().buffer);
  await slowImport;
  assert.match(root.innerHTML,/role="alert"/);
  assert.doesNotMatch(root.innerHTML,/Engine-Ergebnis<\/dt><dd>COMPLETED|Lifecycle<\/dt><dd>completed/);
  await dispatch({size:10,arrayBuffer:async()=>{throw new Error('read failed');}});
  assert.match(root.innerHTML,/role="alert"/);
  const disposedImport=dispatch(slowFile);
  view.dispose();
  const disposedMarkup=root.innerHTML;
  finishSlow(bytes.slice().buffer);
  await disposedImport;
  assert.equal(root.innerHTML,disposedMarkup);
  assert.equal(listeners.size,0);
});

test('queued inspect-shaped observations preserve the full inventory without inventing results',async()=>{
  const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
  const completed=generatedObservation(bridgeManifest,completedResult,'completed','trial-m11-generated-queued-source');
  const observation={
    ...completed,state:'queued',attempts:0,owner:null,fence:0,
    timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null},
    paths:[],controls:null,controlBindings:null,result:null,resultSha256:null,summarySha256:null,
    reason:null,unresolved:false
  };
  const envelope=await exportHistoricalResult({observation,resultBytes:null,syntheticFixture:true});
  const imported=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(envelope)));
  assert.equal(imported.status,'PRESENT_UNVERIFIED');
  assert.equal(imported.job.pathIds.length,44);
  assert.equal(imported.job.paths.length,0);
  assert.equal(imported.result,null);
});

test('export snapshots caller result bytes once and rejects shared, mismatched, and malformed bytes',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const observation=generatedObservation(bridgeManifest,result,'completed','trial-m11-generated-snapshot');
  const bytes=new Uint8Array(new TextEncoder().encode(observation.result));
  const pending=exportHistoricalResult({observation,resultBytes:bytes,syntheticFixture:true});
  bytes.fill(0);
  const envelope=await pending;
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(envelope)))).status,
    'PRESENT_UNVERIFIED');
  const shared=new Uint8Array(new SharedArrayBuffer(new TextEncoder().encode(observation.result).length));
  await assert.rejects(exportHistoricalResult({observation,resultBytes:shared,syntheticFixture:true}),
    /RESULT_BYTES_TYPE/);
  Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(2)});
  await assert.rejects(exportHistoricalResult({observation,resultBytes:shared,syntheticFixture:true}),
    /RESULT_BYTES_TYPE/);
  let bufferGetterCalled=false;
  const maliciousBuffer=new Uint8Array(new TextEncoder().encode(observation.result));
  Object.defineProperty(maliciousBuffer,'buffer',{get(){bufferGetterCalled=true;return new ArrayBuffer(2);}});
  await assert.rejects(exportHistoricalResult({observation,resultBytes:maliciousBuffer,syntheticFixture:true}),
    /RESULT_BYTES_TYPE/);
  assert.equal(bufferGetterCalled,false);
  const detached=new Uint8Array([123,125]);
  structuredClone(detached.buffer,{transfer:[detached.buffer]});
  await assert.rejects(exportHistoricalResult({
    observation:{...observation,result:'{}'},resultBytes:detached,syntheticFixture:true
  }),/RESULT_BYTES_DETACHED/);
  const oversizeBytes=new Uint8Array(1024*1024+1);
  await assert.rejects(exportHistoricalResult({
    observation:{...observation,result:'x'.repeat(oversizeBytes.length)},
    resultBytes:oversizeBytes,syntheticFixture:true
  }),/RESULT_BYTES_LIMIT/);
  await assert.rejects(exportHistoricalResult({observation,resultBytes:new Uint8Array([0xff]),syntheticFixture:true}),
    /RESULT_BYTES_INVALID_UTF8/);
  await assert.rejects(exportHistoricalResult({
    observation:{...observation,result:'\ud800'},resultBytes:new Uint8Array([0xff]),syntheticFixture:true
  }),/RESULT_BYTES_INVALID_UTF8/);
  let getterCalled=false;
  const accessorInput={resultBytes:bytes,syntheticFixture:true};
  Object.defineProperty(accessorInput,'observation',{enumerable:true,get(){getterCalled=true;return observation;}});
  await assert.rejects(exportHistoricalResult(accessorInput),/EXPORT_INPUT_INVALID/);
  assert.equal(getterCalled,false);
});

test('producer result objects enforce exact context schemas and metric array element types',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const source=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-shapes');
  async function assertRejected(mutate){
    const forged=structuredClone(source);
    const parsed=JSON.parse(forged.job.result);
    mutate(parsed);
    forged.job.result=canonicalJson(parsed);
    forged.job.resultSha256=digest(forged.job.result);
    await seal(forged);
    assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(forged)))).status,
      'INVALID');
  }
  await assertRejected(parsed=>{parsed.identity.paths='not an identity property';});
  await assertRejected(parsed=>{
    parsed.identity.canonicalSeriesSha256.XBTUSD='0'.repeat(64);
    parsed.identity.sourceProvenance.syntheticFixtureSeriesSha256.XBTUSD='0'.repeat(64);
  });
  await assertRejected(parsed=>{parsed.executionId='f'.repeat(64);});
  await assertRejected(parsed=>{parsed.paths[0].dailyReturns=['not a number'];});
  await assertRejected(parsed=>{parsed.paths[0].screen={liveAuthorized:false};});
  await assertRejected(parsed=>{delete parsed.paths[0].netReturn;});
  await assertRejected(parsed=>{parsed.paths[0].fillCosts[0].turnover='not a number';});
  await assertRejected(parsed=>{parsed.controlRealization[0].extraKnownField=false;});
});

test('rejected, partial, timed-out and unresolved progress obey job timestamps',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const queued=generatedObservation(bridgeManifest,result,'completed','trial-m11-generated-lifecycle');
  queued.state='queued';queued.attempts=0;queued.owner=null;queued.fence=0;
  queued.timestamps={createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null};
  queued.paths=[];queued.controls=null;queued.controlBindings=null;
  queued.result=null;queued.resultSha256=null;queued.summarySha256=null;
  queued.reason=null;queued.unresolved=false;
  const progress=(index,state,startedAt,completedAt=null)=>({
    pathId:queued.computationPathIds[index],ordinal:index+1,phase:index<19?'DEVELOPMENT':'DIAGNOSTIC',
    state,startedAt,...(completedAt===null?{}:{payloadSha256:'a'.repeat(64),completedAt})
  });
  async function assertAccepted(job){
    const envelope=await exportHistoricalResult({observation:job,resultBytes:null,syntheticFixture:true});
    assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(envelope)))).status,
      'PRESENT_UNVERIFIED',job.state);
  }
  const rejected=structuredClone(queued);
  rejected.state='rejected';rejected.reason='DAILY_BUDGET_EXHAUSTED';
  rejected.timestamps.finishedAt='2026-01-01T00:00:02Z';
  await assertAccepted(rejected);
  const unresolved=structuredClone(queued);
  unresolved.state='unknown';unresolved.attempts=1;unresolved.owner='synthetic-worker';unresolved.fence=1;
  unresolved.unresolved=true;unresolved.timestamps.startedAt='2026-01-01T00:00:01Z';
  unresolved.paths=[progress(0,'started','2026-01-01T00:00:02Z')];
  await assertAccepted(unresolved);
  const partial=structuredClone(unresolved);
  partial.state='partial';partial.unresolved=false;
  partial.timestamps.finishedAt='2026-01-01T00:00:04Z';partial.reason='WORKER_INTERRUPTED';
  partial.paths=[progress(0,'completed','2026-01-01T00:00:02Z','2026-01-01T00:00:03Z'),
    progress(1,'started','2026-01-01T00:00:03Z')];
  await assertAccepted(partial);
  const timedOut=structuredClone(unresolved);
  timedOut.state='timed_out';timedOut.unresolved=false;timedOut.reason='PATH_TIMEOUT';
  timedOut.timestamps.finishedAt='2026-01-01T00:00:04Z';
  await assertAccepted(timedOut);
  const terminalUnknown=structuredClone(unresolved);
  terminalUnknown.unresolved=false;terminalUnknown.timestamps.finishedAt='2026-01-01T00:00:04Z';
  await assertAccepted(terminalUnknown);
  const futureProgress=structuredClone(rejected);
  futureProgress.timestamps.startedAt='2026-01-01T00:00:00Z';
  futureProgress.paths=[progress(0,'completed','2030-01-01T00:00:01Z','2030-01-01T00:00:02Z')];
  const queuedEnvelope=await exportHistoricalResult({observation:queued,resultBytes:null,syntheticFixture:true});
  const futureEnvelope=structuredClone(queuedEnvelope);
  futureEnvelope.job=futureProgress;
  await seal(futureEnvelope);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(futureEnvelope)))).status,
    'INVALID');
  const noJobStart=structuredClone(partial);
  noJobStart.timestamps.startedAt=null;
  const noJobStartEnvelope=structuredClone(queuedEnvelope);
  noJobStartEnvelope.job=noJobStart;
  await seal(noJobStartEnvelope);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(noJobStartEnvelope)))).status,
    'INVALID');
  const regressing=structuredClone(partial);
  regressing.paths[1].startedAt='2026-01-01T00:00:02Z';
  const regressingEnvelope=structuredClone(queuedEnvelope);
  regressingEnvelope.job=regressing;
  await seal(regressingEnvelope);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(regressingEnvelope)))).status,
    'INVALID');
});

test('producer importer rejects duplicate keys, invalid UTF-8, bad digests, identity conflicts and limits',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const source=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-reject');
  const json=JSON.stringify(source);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(
    json.replace('"schema":"MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1"',
      '"schema":"MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1","schema":"MERIDIAN_B1_HISTORICAL_RESULT_EXPORT_V1"')
  ))).status,'INVALID');
  assert.equal((await parseArenaHistoricalExport(new Uint8Array([0xff]))).status,'INVALID');
  assert.equal((await parseArenaHistoricalExport(new Uint8Array([0xef,0xbb,0xbf,0x7b,0x7d]))).status,'INVALID');
  assert.equal((await parseArenaHistoricalExport(new Uint8Array(MAX_HISTORICAL_EXPORT_BYTES+1))).status,'INVALID');
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(json.replace('"attempts":1','"attempts":1.0')))).status,
    'INVALID');
  const corrupt=structuredClone(source);
  corrupt.payloadSha256='0'.repeat(64);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(corrupt)))).status,'INVALID');
  const fixtureConfusion=structuredClone(source);
  fixtureConfusion.schema='MERIDIAN_B1_HISTORICAL_UI_FIXTURE_V1';
  await seal(fixtureConfusion);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(fixtureConfusion)))).status,
    'INVALID');
  const oversizedResult=structuredClone(source);
  oversizedResult.job.result=' '.repeat(1024*1024+1);
  oversizedResult.job.resultSha256=digest(oversizedResult.job.result);
  await seal(oversizedResult);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(oversizedResult)))).status,
    'INVALID');
  const oversizedControls=structuredClone(source);
  oversizedControls.job.controls=' '.repeat(8193);
  await seal(oversizedControls);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(oversizedControls)))).status,
    'INVALID');
  const mismatch=structuredClone(source);
  mismatch.job.dataSha256='0'.repeat(64);
  await seal(mismatch);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(mismatch)))).status,'INVALID');
  const tuple=structuredClone(source);
  tuple.job.pathIds[0]=tuple.job.pathIds[1];
  await seal(tuple);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(tuple)))).status,'INVALID');
  const tupleConflict=structuredClone(source);
  const conflictingResult=JSON.parse(tupleConflict.job.result);
  conflictingResult.paths[0].variantId='neighbour-n20-f25';
  tupleConflict.job.result=canonicalJson(conflictingResult);
  tupleConflict.job.resultSha256=digest(tupleConflict.job.result);
  await seal(tupleConflict);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(tupleConflict)))).status,
    'INVALID');
});

test('nested duplicate keys, nonfinite metrics, authority escalation and lifecycle mismatches fail closed',async()=>{
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const source=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-nested');
  const nestedDuplicate=structuredClone(source);
  nestedDuplicate.job.result=nestedDuplicate.job.result.replace('"status":"COMPLETED"',
    '"status":"COMPLETED","status":"COMPLETED"');
  nestedDuplicate.job.resultSha256=digest(nestedDuplicate.job.result);
  const duplicateBytes=new TextEncoder().encode(nestedDuplicate.job.result);
  nestedDuplicate.job.resultSha256=digest(duplicateBytes);
  await seal(nestedDuplicate);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(nestedDuplicate)))).status,'INVALID');
  const tooDeep=structuredClone(source);
  tooDeep.job.result=`${'{"failure":'.repeat(14)}null${'}'.repeat(14)}`;
  tooDeep.job.resultSha256=digest(tooDeep.job.result);
  await seal(tooDeep);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(tooDeep)))).status,'INVALID');
  const tooManyNodes=structuredClone(source);
  tooManyNodes.job.result=`[${'0,'.repeat(100_000)}0]`;
  tooManyNodes.job.resultSha256=digest(tooManyNodes.job.result);
  await seal(tooManyNodes);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(tooManyNodes)))).status,
    'INVALID');
  const badMetric=structuredClone(source);
  badMetric.job.result=badMetric.job.result.replace(/"netReturn":-?[0-9.eE+-]+/,'"netReturn":1e400');
  badMetric.job.resultSha256=digest(badMetric.job.result);
  await seal(badMetric);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(badMetric)))).status,'INVALID');
  const authority=structuredClone(source);
  const parsed=JSON.parse(authority.job.result);
  parsed.authority.liveAuthorized=true;
  authority.job.result=canonicalJson(parsed);
  authority.job.resultSha256=digest(authority.job.result);
  await seal(authority);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(authority)))).status,'INVALID');
  const state=structuredClone(source);
  state.job.state='failed';
  await seal(state);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(state)))).status,'INVALID');
});

test('canonical payload preserves Python ASCII escapes and raw nested metric spelling',async()=>{
  const vectors=[
    [String.raw`{"del":"\u007f"}`,'2a4be89ced8ad4d4ff64d890bb443669cd846aaf7b706c45ba3218cee13a30ad'],
    [String.raw`{"a":"\u00e9\ud83d\ude00\u0001\"\\","\ue000":1,"\ud83d\ude00":2}`,
      '6bf91139486f75ee8b91fca021f4bc7ba7e62e500cd54966677c12e0145d6846'],
    ['{"max":9007199254740991,"zero":0}','d1c6de4fff64001e181a639bafdc8cf052b2b3c99db136a90f8653ac648f1b48']
  ];
  for(const [canonical,expected] of vectors)assert.equal(digest(Buffer.from(canonical,'ascii')),expected);
  assert.equal(canonicalHistoricalExportPayload({del:'\u007f'}),vectors[0][0]);
  assert.equal(canonicalHistoricalExportPayload({
    a:'é😀\u0001"\\', '\ue000':1, '😀':2
  }),vectors[1][0]);
  assert.equal(canonicalHistoricalExportPayload({max:Number.MAX_SAFE_INTEGER,zero:0}),vectors[2][0]);
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const original=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-raw-number');
  for(const spelling of ['0','0.0','-0']){
    const changed=structuredClone(original);
    changed.job.result=changed.job.result.replace(/"netReturn":(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
      `"netReturn":${spelling}`);
    changed.job.resultSha256=digest(changed.job.result);
    await seal(changed);
    const imported=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(changed)));
    assert.equal(imported.status,'PRESENT_UNVERIFIED',spelling);
    assert.ok(imported.job.result.includes(`"netReturn":${spelling}`));
  }
});
