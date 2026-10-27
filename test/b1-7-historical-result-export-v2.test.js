import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {
  HISTORICAL_EXPORT_V2_SCHEMA,MAX_HISTORICAL_EXPORT_V2_BYTES,
  MAX_HISTORICAL_RESULT_V2_BYTES,canonicalHistoricalExportV2Payload,
  parseArenaHistoricalExportV2
} from '../v11/arena-historical-export-v2.js';
import {parseArenaHistoricalExport} from '../v11/arena-historical-export.js';
import {exportHistoricalResultV2} from '../scripts/research/b1-7/export-historical-result-v2.mjs';
import {renderReviewReport} from '../scripts/research/b1-7/render-review-report.mjs';
import {
  generatedEnvelope,generatedResult
} from './fixtures/b1-7/historical-export.mjs';
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';
import {
  createInsufficientEvidenceProfile,createInsufficientEvidenceSeries
} from '../scripts/research-supervisor/test_b1_generated_fixture.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value));
const canonical=value=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const digestBytes=async bytes=>digest(bytes);

async function historicalInput(profile,result,state,key,screenStatus='NO_EDGE'){
  const generated=await generatedEnvelope(profile,result,state,key);
  const observation=structuredClone(generated.job);
  observation.profile='MERIDIAN-B1-7-HISTORICAL-ONE-SHOT-R1';
  if(!observation.result)return {observation,resultBytes:null,summaryBytes:null};
  const historical=JSON.parse(observation.result);
  historical.identity.datasetKind='FROZEN_RESEARCH_INPUT';
  historical.identity.sourceCommit='generated-historical-fixture-commit';
  historical.identity.sourceProvenance={
    normalizedFileSha256:{'generated-fixture.csv':'f'.repeat(64)}
  };
  historical.evidence.syntheticFixture=false;
  historical.evidence.priceSource='PINNED_KRAKEN_SPOT_USD_CANDLES';
  historical.evidence.sourceAuthenticity='NOT_ESTABLISHED';
  if(historical.status==='COMPLETED'){
    if(screenStatus==='INSUFFICIENT_EVIDENCE'){
      historical.screen={
        status:'INSUFFICIENT_EVIDENCE',
        checks:{fullBasketDrawdownDenominator:false},
        relativeDrawdownReduction:null
      };
    }else{
      historical.screen.status=screenStatus;
      historical.screen.interpretation='HISTORICAL_CANDIDATE_ONLY_NOT_HOLDOUT';
    }
  }
  const withoutProjection={...historical};
  delete withoutProjection.paths;
  delete withoutProjection.controlDefinitions;
  const resultBytes=Buffer.from(canonical(historical));
  const summaryBytes=Buffer.from(canonical(withoutProjection));
  observation.result=resultBytes.toString('utf8');
  observation.resultSha256=digest(resultBytes);
  observation.summarySha256=digest(summaryBytes);
  return {observation,resultBytes,summaryBytes};
}

async function makeEnvelope(profile,result,state,key,screenStatus){
  const input=await historicalInput(profile,result,state,key,screenStatus);
  return exportHistoricalResultV2({
    ...input,
    resultBytes:input.resultBytes===null?null:new Uint8Array(input.resultBytes),
    summaryBytes:input.summaryBytes===null?null:new Uint8Array(input.summaryBytes),
    generatedFixture:true
  });
}

async function seal(envelope){
  envelope.payloadSha256=digest(Buffer.from(canonicalHistoricalExportV2Payload(envelope),'ascii'));
  return envelope;
}

let fixturesPromise;
async function fixtures(){
  if(fixturesPromise)return fixturesPromise;
  fixturesPromise=(async()=>{
    const complete=generatedResult(bridgeManifest,createSyntheticSeries());
    const insufficientProfile=createInsufficientEvidenceProfile();
    const insufficient=generatedResult(insufficientProfile,createInsufficientEvidenceSeries());
    return {
      pass:await makeEnvelope(bridgeManifest,complete,'completed','trial-v2-pass','PASS'),
      noEdge:await makeEnvelope(bridgeManifest,complete,'completed','trial-v2-no-edge','NO_EDGE'),
      completedInsufficient:await makeEnvelope(
        bridgeManifest,complete,'completed','trial-v2-completed-insufficient','INSUFFICIENT_EVIDENCE'
      ),
      engineInsufficient:await makeEnvelope(
        insufficientProfile,insufficient,'failed','trial-v2-engine-insufficient'
      )
    };
  })();
  return fixturesPromise;
}

test('historical V2 preserves three distinct historical screen and engine states',async()=>{
  const values=await fixtures();
  for(const [envelope,engineStatus,screenStatus,pathStatuses] of [
    [values.pass,'COMPLETED','PASS',44],
    [values.noEdge,'COMPLETED','NO_EDGE',44],
    [values.completedInsufficient,'COMPLETED','INSUFFICIENT_EVIDENCE',44],
    [values.engineInsufficient,'INSUFFICIENT_EVIDENCE','INSUFFICIENT_EVIDENCE',19]
  ]){
    const projection=await parseArenaHistoricalExportV2(encode(envelope),digestBytes);
    assert.equal(projection.status,'PRESENT_UNVERIFIED');
    assert.equal(projection.schema,HISTORICAL_EXPORT_V2_SCHEMA);
    assert.equal(projection.result.status,engineStatus);
    assert.equal(projection.result.screen.status,screenStatus);
    assert.equal(projection.result.paths.filter(path=>path.status==='COMPLETED').length,pathStatuses);
    assert.equal(projection.job.pathIds.length,44);
    assert.equal(projection.job.computationPathIds.length,44);
    assert.equal(projection.verification.resultBytes,'VERIFIED_EXACT_BYTES');
    assert.equal(projection.verification.summaryBytes,'VERIFIED_EXACT_BYTES');
    assert.equal(projection.verification.summaryProjection,
      'VERIFIED_EXCLUDING_PATHS_AND_CONTROL_DEFINITIONS');
    assert.equal(projection.verification.progressPayloads,
      'NOT_VERIFIED_ORIGINAL_BYTES_NOT_SUPPLIED');
    assert.equal(projection.provenance.generatedFixture,true);
    if(engineStatus==='INSUFFICIENT_EVIDENCE'){
      assert.equal(projection.job.state,'failed');
      assert.equal(projection.result.paths.filter(path=>
        path.status==='NOT_RUN_INSUFFICIENT_EVIDENCE').length,25);
    }
  }
  assert.equal((await parseArenaHistoricalExport(encode(values.noEdge),digestBytes)).status,'INVALID');
});

test('V2 exporter and shared report keep inventory, controls, costs, quarters and lifecycle separate',async()=>{
  const values=await fixtures();
  const bytes=encode(values.noEdge);
  const first=await renderReviewReport(bytes);
  assert.equal(first,await renderReviewReport(bytes));
  assert.match(first,/HISTORICAL V2/);
  assert.match(first,/sourceAuthenticity/);
  assert.match(first,/NO\\_EDGE/);
  assert.match(first,/NOT\\_VERIFIED\\_ORIGINAL\\_BYTES\\_NOT\\_SUPPLIED/);
  assert.match(first,/daily budget/);
  assert.match(first,/NOT_SUPPLIED/);
  const firstPath=values.noEdge.job.result&&JSON.parse(values.noEdge.job.result).paths[0];
  assert.ok(first.includes(firstPath.quarterlyReturns[0].quarter.replace('-','\\-')));
  assert.match(first,/totalCosts/);
  assert.equal(first.split('## Path identity inventory — manifest order')[1]
    .split('## Computation order')[0].split('\n')
    .filter(line=>/^\| \d+ \| [a-f0-9]{64} \|/.test(line)).length,44);
  assert.ok(first.includes('primaryDevelopmentSha256'));
  assert.ok(first.includes('fullBasketDevelopmentSha256'));
  const insufficient=await renderReviewReport(encode(values.engineInsufficient));
  assert.match(insufficient,/19/);
  assert.match(insufficient,/NOT\\_RUN\\_INSUFFICIENT\\_EVIDENCE/);
  assert.equal((await parseArenaHistoricalExportV2(encode(values.engineInsufficient),digestBytes))
    .result.paths.length,44);
});

test('summary/result byte digests and exact projection reject alteration and substitution',async()=>{
  const values=await fixtures(),source=values.noEdge;
  const badBytes=structuredClone(source);
  badBytes.summary=`${badBytes.summary} `;
  await seal(badBytes);
  assert.equal((await parseArenaHistoricalExportV2(encode(badBytes),digestBytes)).status,'INVALID');

  const changedSummary=structuredClone(source);
  const changed=JSON.parse(changedSummary.summary);
  changed.completedPaths--;
  changedSummary.summary=canonical(changed);
  changedSummary.job.summarySha256=digest(changedSummary.summary);
  await seal(changedSummary);
  assert.equal((await parseArenaHistoricalExportV2(encode(changedSummary),digestBytes)).status,'INVALID');

  const changedResult=structuredClone(source);
  const result=JSON.parse(changedResult.job.result);
  result.paths[0].pathId=result.paths[1].pathId;
  changedResult.job.result=canonical(result);
  changedResult.job.resultSha256=digest(changedResult.job.result);
  const summary={...result};
  delete summary.paths;
  delete summary.controlDefinitions;
  changedResult.summary=canonical(summary);
  changedResult.job.summarySha256=digest(changedResult.summary);
  await seal(changedResult);
  assert.equal((await parseArenaHistoricalExportV2(encode(changedResult),digestBytes)).status,'INVALID');

  const wrongControlOrder=structuredClone(source);
  wrongControlOrder.job.controlBindings.primaryDevelopmentSha256=
    wrongControlOrder.job.paths[1].payloadSha256;
  await seal(wrongControlOrder);
  assert.equal((await parseArenaHistoricalExportV2(encode(wrongControlOrder),digestBytes)).status,'INVALID');

  const unverifiedProgress=structuredClone(source);
  unverifiedProgress.job.paths[1].payloadSha256='0'.repeat(64);
  await seal(unverifiedProgress);
  const projection=await parseArenaHistoricalExportV2(encode(unverifiedProgress),digestBytes);
  assert.equal(projection.status,'PRESENT_UNVERIFIED');
  assert.equal(projection.verification.progressPayloads,
    'NOT_VERIFIED_ORIGINAL_BYTES_NOT_SUPPLIED');
});

test('V2 rejects wrong bindings, substitution, duplicate keys, invalid UTF-8, size and synthetic results',async()=>{
  const values=await fixtures(),source=values.noEdge;
  for(const mutate of [
    value=>{value.job.protocolSha256='0'.repeat(64);},
    value=>{value.job.dataSha256='0'.repeat(64);},
    value=>{value.job.computationPathIds[0]=value.job.computationPathIds[1];},
    value=>{value.job.pathIds.pop();},
    value=>{value.job.profile='MERIDIAN-B1-7-GENERATED-FIXTURE-BRIDGE-R1';}
  ]){
    const changed=structuredClone(source);mutate(changed);await seal(changed);
    assert.equal((await parseArenaHistoricalExportV2(encode(changed),digestBytes)).status,'INVALID');
  }
  const changedSource=structuredClone(source);
  changedSource.job.sourceSha256='0'.repeat(64);
  assert.equal((await parseArenaHistoricalExportV2(encode(changedSource),digestBytes)).status,'INVALID');
  const synthetic=structuredClone(source);
  const syntheticResult=JSON.parse(synthetic.job.result);
  syntheticResult.evidence.syntheticFixture=true;
  synthetic.job.result=canonical(syntheticResult);
  synthetic.job.resultSha256=digest(synthetic.job.result);
  const syntheticSummary={...syntheticResult};
  delete syntheticSummary.paths;
  delete syntheticSummary.controlDefinitions;
  synthetic.summary=canonical(syntheticSummary);
  synthetic.job.summarySha256=digest(synthetic.summary);
  await seal(synthetic);
  assert.equal((await parseArenaHistoricalExportV2(encode(synthetic),digestBytes)).status,'INVALID');

  const duplicate=encode(source).toString('utf8').replace(
    `"schema":"${HISTORICAL_EXPORT_V2_SCHEMA}"`,
    `"schema":"${HISTORICAL_EXPORT_V2_SCHEMA}","schema":"${HISTORICAL_EXPORT_V2_SCHEMA}"`
  );
  assert.equal((await parseArenaHistoricalExportV2(Buffer.from(duplicate),digestBytes)).status,'INVALID');
  assert.equal((await parseArenaHistoricalExportV2(new Uint8Array([0xff]),digestBytes)).status,'INVALID');
  assert.equal((await parseArenaHistoricalExportV2(
    new Uint8Array(MAX_HISTORICAL_EXPORT_V2_BYTES+1),digestBytes
  )).status,'INVALID');
  const tooLarge=structuredClone(source);
  tooLarge.job.result=' '.repeat(MAX_HISTORICAL_RESULT_V2_BYTES+1);
  await seal(tooLarge);
  assert.equal((await parseArenaHistoricalExportV2(encode(tooLarge),digestBytes)).status,'INVALID');

  const nestedDuplicate=structuredClone(source);
  nestedDuplicate.job.result=nestedDuplicate.job.result.replace('"status":"COMPLETED"',
    '"status":"COMPLETED","status":"COMPLETED"');
  nestedDuplicate.job.resultSha256=digest(nestedDuplicate.job.result);
  await seal(nestedDuplicate);
  assert.equal((await parseArenaHistoricalExportV2(encode(nestedDuplicate),digestBytes)).status,'INVALID');
});

test('V2 retains no-result unknown, partial, queued and missing-budget distinctions',async()=>{
  const values=await fixtures();
  const base=structuredClone(values.noEdge);
  for(const state of ['partial','unknown','queued']){
    const variant=structuredClone(base);
    variant.job.state=state;
    variant.job.result=null;
    variant.job.resultSha256=null;
    variant.job.summarySha256=null;
    variant.summary=null;
    if(state==='queued'){
      variant.job.attempts=0;variant.job.owner=null;variant.job.fence=0;
      variant.job.timestamps.startedAt=null;variant.job.timestamps.finishedAt=null;
      variant.job.paths=[];variant.job.controls=null;variant.job.controlBindings=null;
      variant.job.unresolved=false;variant.job.reason=null;
    }else{
      variant.job.paths=variant.job.paths.slice(0,19);
      variant.job.timestamps.finishedAt=state==='unknown'?null:'2026-01-01T00:00:02Z';
      variant.job.unresolved=state==='unknown';
      variant.job.reason=state==='unknown'?'RECONCILIATION_REQUIRED':'WORKER_INTERRUPTED';
    }
    if(state==='partial')variant.job.reason='unsafe <script>alert(1)</script> ![x](https://bad.example)';
    await seal(variant);
    const projection=await parseArenaHistoricalExportV2(encode(variant),digestBytes);
    assert.equal(projection.status,'PRESENT_UNVERIFIED',state);
    assert.equal(projection.job.state,state);
    assert.equal(projection.result,null);
    const report=await renderReviewReport(encode(variant));
    assert.doesNotMatch(report,/dailyBudget\s*\|\s*(?:0|[1-9])/);
    if(state==='partial'){
      assert.doesNotMatch(report,/<script|\]\(|!\[/i);
      assert.match(report,/&lt;script&gt;/);
    }
  }
});

test('V2 exporter rejects nonmatching or invalid UTF-8 byte snapshots',async()=>{
  const prepared=await historicalInput(
    bridgeManifest,generatedResult(bridgeManifest,createSyntheticSeries()),
    'completed','trial-v2-invalid-bytes','NO_EDGE'
  );
  const args={
    observation:prepared.observation,resultBytes:new Uint8Array(prepared.resultBytes),
    summaryBytes:new Uint8Array(prepared.summaryBytes),generatedFixture:true
  };
  const mismatch={...args,resultBytes:new TextEncoder().encode('{"substituted":true}')};
  await assert.rejects(exportHistoricalResultV2(mismatch),{message:'EXPORT_INPUT_INVALID'});
  const invalidUtf8={...args,resultBytes:new Uint8Array([0xff])};
  await assert.rejects(exportHistoricalResultV2(invalidUtf8),{message:'EXPORT_INPUT_INVALID'});
});

test('V2 exporter and parser remain offline and do not import the engine or journal',()=>{
  const parser=readFileSync(new URL('../v11/arena-historical-export-v2.js',import.meta.url),'utf8');
  const exporter=readFileSync(new URL(
    '../scripts/research/b1-7/export-historical-result-v2.mjs',import.meta.url
  ),'utf8');
  assert.doesNotMatch(parser,/^import\s|\bfetch\s*\(/m);
  assert.doesNotMatch(exporter,/from ['"][^'"]*(?:engine|journal|captured-input|supervisor)\.mjs/);
  assert.doesNotMatch(exporter,/\b(?:fetch|readFileSync|writeFileSync|createExecution|runBatch)\s*\(/);
});

test('V2 CLI emits a complete envelope or no stdout on invalid caller bytes',async()=>{
  const values=await fixtures();
  const prepared=await historicalInput(
    bridgeManifest,generatedResult(bridgeManifest,createSyntheticSeries()),
    'completed','trial-v2-cli','NO_EDGE'
  );
  const cliInput={
    observation:prepared.observation,
    resultBytesBase64:prepared.resultBytes.toString('base64'),
    summaryBytesBase64:prepared.summaryBytes.toString('base64'),
    generatedFixture:true
  };
  const script=new URL('../scripts/research/b1-7/export-historical-result-v2.mjs',import.meta.url);
  const success=spawnSync(process.execPath,[script.pathname],{input:JSON.stringify(cliInput),encoding:'utf8'});
  assert.equal(success.status,0,success.stderr);
  const output=JSON.parse(success.stdout);
  assert.equal(output.schema,HISTORICAL_EXPORT_V2_SCHEMA);
  assert.equal((await parseArenaHistoricalExportV2(encode(output),digestBytes)).status,'PRESENT_UNVERIFIED');
  const reportScript=new URL('../scripts/research/b1-7/render-review-report.mjs',import.meta.url);
  const reportRun=spawnSync(process.execPath,[reportScript.pathname],{input:success.stdout,encoding:'utf8'});
  assert.equal(reportRun.status,0,reportRun.stderr);
  assert.match(reportRun.stdout,/HISTORICAL V2/);
  for(const input of [
    JSON.stringify({...cliInput,summaryBytesBase64:null}),
    `{"observation":{},"observation":{},"resultBytesBase64":null,"summaryBytesBase64":null,"generatedFixture":true}`,
    'not-json'
  ]){
    const failed=spawnSync(process.execPath,[script.pathname],{input,encoding:'utf8'});
    assert.notEqual(failed.status,0);
    assert.equal(failed.stdout,'');
    assert.match(failed.stderr,/^ERROR EXPORT_/);
  }
  assert.equal(values.pass.provenance.generatedFixture,true);
});
