import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {
  canonicalHistoricalExportPayload,parseArenaHistoricalExport,validateArenaHistoricalExport,
  MAX_HISTORICAL_EXPORT_BYTES
} from '../v11/arena-historical-export.js';
import {exportHistoricalResult} from '../scripts/research/b1-7/export-historical-result.mjs';
import {createExecution,canonicalJson,sha256} from '../scripts/research/b1-7/engine.mjs';
import {createSyntheticSeries} from '../test/fixtures/b1-7/synthetic-series.mjs';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {
  createInsufficientEvidenceProfile,createInsufficientEvidenceSeries
} from '../scripts/research-supervisor/test_b1_generated_fixture.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const digestBytes=async bytes=>digest(bytes);
const pythonGenerator=String.raw`
import hashlib, json, sys
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
def sha(value):
    return hashlib.sha256(value).hexdigest()
source = json.load(sys.stdin)
profile, result, state, trial_key = source['profile'], source['result'], source['state'], source['trialKey']
result_bytes = canonical(result).encode('ascii')
by_id = {path['pathId']: path for path in result['paths']}
computation_ids = [profile['pathIds'][i] for i in profile['computationOrder']]
count = 44 if result['status'] == 'COMPLETED' else 19
paths = [{
    'pathId': path_id, 'ordinal': index + 1,
    'phase': 'DEVELOPMENT' if index < 19 else 'DIAGNOSTIC',
    'state': 'completed', 'startedAt': '2026-01-01T00:00:01Z',
    'payloadSha256': sha(canonical(by_id[path_id]).encode('ascii')),
    'completedAt': '2026-01-01T00:00:01Z'
} for index, path_id in enumerate(computation_ids[:count])]
summary = {key: value for key, value in result.items() if key not in ('paths', 'controlDefinitions')}
controls = canonical(result['controlDefinitions'])
job = {
    'trialId': sha(trial_key.encode('utf8')), 'trialKey': trial_key,
    'state': state, 'attempts': 1, 'owner': 'synthetic-generated-sample', 'fence': 1,
    'profile': profile['profile'], 'protocolSha256': profile['protocolSha256'],
    'sourceSha256': profile.get('sourceIdentitySha256') or sha(canonical(profile['sourceSha256']).encode('ascii')),
    'dataSha256': profile['inputSha256'], 'manifestSha256': profile['manifestSha256'],
    'pathIds': profile['pathIds'], 'computationPathIds': computation_ids,
    'timestamps': {'createdAt': '2026-01-01T00:00:00Z', 'startedAt': '2026-01-01T00:00:01Z',
                   'finishedAt': '2026-01-01T00:00:01Z'},
    'paths': paths, 'controls': controls,
    'controlBindings': {'primaryDevelopmentSha256': paths[0]['payloadSha256'],
                        'fullBasketDevelopmentSha256': paths[15]['payloadSha256']},
    'result': result_bytes.decode('utf8'), 'resultSha256': sha(result_bytes),
    'summarySha256': sha(canonical(summary).encode('ascii')),
    'reason': None if result['status'] == 'COMPLETED' else 'INVALID_OR_ZERO_DEVELOPMENT_RISK_DENOMINATOR',
    'unresolved': False, 'executionAuthorized': False, 'promotionAuthorized': False,
    'profitabilityInferred': False
}
print(json.dumps(job, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False))
`;

function generatedResult(profile,series){
  const execution=createExecution({
    seriesByAsset:series,
    source:{kind:'SYNTHETIC_FIXTURE'},
    implementationSha256:profile.implementationSha256
  });
  while(execution.status==='READY')execution.advanceOne();
  return execution.finalResult();
}

function generatedObservation(profile,result,state,trialKey){
  const input=JSON.stringify({profile,result:JSON.parse(JSON.stringify(result)),state,trialKey});
  const generated=spawnSync('python3',['-c',pythonGenerator],{
    input,encoding:'utf8',maxBuffer:8*1024*1024
  });
  assert.equal(generated.status,0,generated.stderr);
  return JSON.parse(generated.stdout);
}

async function generatedEnvelope(profile,result,state,trialKey){
  const observation=generatedObservation(profile,result,state,trialKey);
  const resultBytes=observation.result===null?null:new TextEncoder().encode(observation.result);
  return exportHistoricalResult({observation,resultBytes,syntheticFixture:true});
}

async function seal(envelope){
  envelope.payloadSha256=digest(Buffer.from(canonicalHistoricalExportPayload(envelope),'ascii'));
  return envelope;
}

test('synthetic generated completed and insufficient results round-trip with exact producer bytes',async()=>{
  const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
  const insufficientProfile=createInsufficientEvidenceProfile();
  const insufficientResult=generatedResult(insufficientProfile,createInsufficientEvidenceSeries());
  assert.equal(completedResult.status,'COMPLETED');
  assert.equal(insufficientResult.status,'INSUFFICIENT_EVIDENCE');
  const completed=await generatedEnvelope(bridgeManifest,completedResult,'completed','trial-m11-generated-completed');
  const insufficient=await generatedEnvelope(insufficientProfile,insufficientResult,'failed','trial-m11-generated-insufficient');
  for(const [envelope,status,count] of [[completed,'COMPLETED',44],[insufficient,'INSUFFICIENT_EVIDENCE',19]]){
    const sourceBytes=new TextEncoder().encode(envelope.job.result);
    const imported=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(envelope)));
    assert.equal(imported.status,'PRESENT_UNVERIFIED');
    assert.equal(imported.job.resultSha256,digest(sourceBytes));
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
  assert.equal(Buffer.byteLength(completed.job.result),939389);
  assert.equal(Buffer.byteLength(insufficient.job.result),207285);
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
  assert.rejects(exportHistoricalResult({observation,resultBytes:shared,syntheticFixture:true}),
    /RESULT_BYTES_TYPE/);
  assert.rejects(exportHistoricalResult({observation,resultBytes:new Uint8Array([0xff]),syntheticFixture:true}),
    /RESULT_BYTES_INVALID_UTF8/);
  assert.rejects(exportHistoricalResult({
    observation:{...observation,result:'\ud800'},resultBytes:new Uint8Array([0xff]),syntheticFixture:true
  }),/RESULT_BYTES_INVALID_UTF8/);
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
  assert.equal((await parseArenaHistoricalExport(new Uint8Array(MAX_HISTORICAL_EXPORT_BYTES+1))).status,'INVALID');
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(json.replace('"attempts":1','"attempts":1.0')))).status,
    'INVALID');
  const corrupt=structuredClone(source);
  corrupt.payloadSha256='0'.repeat(64);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(corrupt)))).status,'INVALID');
  const mismatch=structuredClone(source);
  mismatch.job.dataSha256='0'.repeat(64);
  await seal(mismatch);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(mismatch)))).status,'INVALID');
  const tuple=structuredClone(source);
  tuple.job.pathIds[0]=tuple.job.pathIds[1];
  await seal(tuple);
  assert.equal((await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(tuple)))).status,'INVALID');
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
      '6bf91139486f75ee8b91fca021f4bc7ba7e62e500cd54966677c12e0145d6846']
  ];
  for(const [canonical,expected] of vectors)assert.equal(digest(Buffer.from(canonical,'ascii')),expected);
  const result=generatedResult(bridgeManifest,createSyntheticSeries());
  const original=await generatedEnvelope(bridgeManifest,result,'completed','trial-m11-generated-raw-number');
  const changed=structuredClone(original);
  changed.job.result=changed.job.result.replace(/"netReturn":(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    '"netReturn":0.0');
  changed.job.resultSha256=digest(changed.job.result);
  await seal(changed);
  const imported=await parseArenaHistoricalExport(new TextEncoder().encode(JSON.stringify(changed)));
  assert.equal(imported.status,'PRESENT_UNVERIFIED');
  assert.match(imported.job.result,/"netReturn":0\.0/);
});
