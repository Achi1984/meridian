import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {
  HISTORICAL_EXPORT_SCHEMA, HISTORICAL_EXPORT_PURPOSE, MAX_HISTORICAL_EXPORT_BYTES,
  parseArenaHistoricalExport
} from '../v11/arena-historical-export.js';
import {
  MAX_REVIEW_REPORT_BYTES, renderParsedReviewReport, renderReviewReport
} from '../scripts/research/b1-7/render-review-report.mjs';
import {createSyntheticSeries} from './fixtures/b1-7/synthetic-series.mjs';
import {
  generatedEnvelope, generatedResult, seal
} from './fixtures/b1-7/historical-export.mjs';
import {
  createInsufficientEvidenceProfile, createInsufficientEvidenceSeries
} from '../scripts/research-supervisor/test_b1_generated_fixture.mjs';

const encode = envelope => Buffer.from(JSON.stringify(envelope));
const computationPathIds = () => bridgeManifest.computationOrder.map(index=>bridgeManifest.pathIds[index]);
const inventoryLines = report => report.split('## Path identity inventory — manifest order')[1]
  .split('## Computation order')[0].split('\n')
  .filter(line=>/^\| \d+ \| [a-f0-9]{64} \|/.test(line));

let generatedExportsPromise;
async function generatedExports(){
  if(generatedExportsPromise)return generatedExportsPromise;
  generatedExportsPromise=(async()=>{
    const completedResult=generatedResult(bridgeManifest,createSyntheticSeries());
    const insufficientProfile=createInsufficientEvidenceProfile();
    const insufficientResult=generatedResult(
      insufficientProfile,createInsufficientEvidenceSeries()
    );
    return {
      completed:await generatedEnvelope(
        bridgeManifest,completedResult,'completed','trial-review-report-completed'
      ),
      insufficient:await generatedEnvelope(
        insufficientProfile,insufficientResult,'failed','trial-review-report-insufficient'
      )
    };
  })();
  return generatedExportsPromise;
}

async function noResultVariant(envelope,state){
  const variant=structuredClone(envelope);
  variant.job.state=state;
  variant.job.paths=variant.job.paths.slice(0,19);
  variant.job.result=null;
  variant.job.resultSha256=null;
  variant.job.summarySha256=null;
  variant.job.reason=state==='unknown'?'RECONCILIATION_REQUIRED':null;
  variant.job.unresolved=state==='unknown';
  variant.job.timestamps.finishedAt=state==='unknown'?null:'2026-01-01T00:00:02Z';
  await seal(variant);
  return variant;
}

async function queuedEnvelope(){
  const digest=value=>createHash('sha256').update(value).digest('hex');
  const trialKey='trial-review-report-queued';
  const envelope={
    schema:HISTORICAL_EXPORT_SCHEMA,
    purpose:HISTORICAL_EXPORT_PURPOSE,
    provenance:{
      source:'CALLER_SUPPLIED_INSPECT_B1',assertionStatus:'UNVERIFIED',
      sourceAuthenticity:'NOT_ESTABLISHED',syntheticFixture:true
    },
    job:{
      trialId:digest(Buffer.from(trialKey)),trialKey,state:'queued',attempts:0,owner:null,fence:0,
      profile:bridgeManifest.profile,protocolSha256:bridgeManifest.protocolSha256,
      sourceSha256:'bab379ce692601315ef3b0436ac7969798e96cc9781f7f3845ec4ed8a2b770e7',
      dataSha256:bridgeManifest.inputSha256,manifestSha256:bridgeManifest.manifestSha256,
      pathIds:bridgeManifest.pathIds,computationPathIds:computationPathIds(),
      timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null},
      paths:[],controls:null,controlBindings:null,result:null,resultSha256:null,summarySha256:null,
      reason:null,unresolved:false,executionAuthorized:false,promotionAuthorized:false,
      profitabilityInferred:false
    },
    payloadSha256:'0'.repeat(64)
  };
  await seal(envelope);
  return envelope;
}

test('accepted synthetic completed export renders deterministically and preserves returned values',async()=>{
  const {completed}=await generatedExports();
  const bytes=encode(completed);
  const before=Buffer.from(bytes);
  const first=await renderReviewReport(bytes);
  const second=await renderReviewReport(bytes);
  assert.equal(first,second);
  assert.deepEqual(bytes,before);
  assert.match(first,/SYNTHETIC\-ONLY EXPORT CONTRACT/);
  assert.match(first,/engineStatus/);
  assert.match(first,/COMPLETED/);
  assert.match(first,/screenStatus/);
  assert.match(first,/SYNTHETIC\\_ONLY\\_NOT\\_ASSESSED/);
  assert.match(first,/sourceAuthenticity/);
  assert.match(first,/NOT\\_ESTABLISHED/);
  assert.match(first,/holdoutAuthorized/);
  assert.match(first,/NO\\_FINITE\\_TRADE\\_STOP/);
  assert.match(first,/2025\\-Q2/);
  const parsedResult=JSON.parse(completed.job.result);
  const firstQuarter=parsedResult.paths[0].quarterlyReturns[0];
  assert.ok(first.includes(firstQuarter.quarter.replace('-', '\\-')));
  const quarterValue=Object.is(firstQuarter.netReturn,-0)?'-0':String(firstQuarter.netReturn);
  assert.ok(first.includes(quarterValue.replace(/[\\.-]/g,'\\$&')));
  assert.ok(parsedResult.paths.some(path=>path.kind==='CASH'&&path.totalCosts===0));
  assert.ok(first.includes('totalCosts\\"\\:0'));
  assert.ok(first.includes('promotionEligible\\"\\:false'));
  assert.ok(first.includes('value\\"\\:null'));
  assert.equal(inventoryLines(first).length,44);
  for(const id of bridgeManifest.pathIds)assert.ok(first.includes(id));
  assert.ok(first.includes('controls'));
  assert.ok(first.includes('controlBindings'));
  assert.equal(Buffer.byteLength(first),Buffer.byteLength(first,'utf8'));
});

test('accepted early-insufficient export preserves actual 19 completed and 25 no-run records',async()=>{
  const {insufficient}=await generatedExports();
  const report=await renderReviewReport(encode(insufficient));
  const rows=inventoryLines(report);
  assert.equal(rows.length,44);
  assert.equal(rows.filter(line=>line.includes('COMPLETED')).length,19);
  assert.equal(rows.filter(line=>line.includes('NOT\\_RUN\\_INSUFFICIENT\\_EVIDENCE')).length,25);
  assert.match(report,/engineStatus/);
  assert.match(report,/INSUFFICIENT\\_EVIDENCE/);
  assert.match(report,/screenStatus/);
});

test('partial and unresolved parser-accepted exports retain supplied controls without results',async()=>{
  const {completed}=await generatedExports();
  for(const [state,expectedUnresolved] of [['partial','false'],['unknown','true']]){
    const envelope=await noResultVariant(completed,state);
    const report=await renderReviewReport(encode(envelope));
    assert.match(report,new RegExp(`\\| state \\| ${state} \\|`));
    assert.match(report,new RegExp(`\\| unresolved \\| ${expectedUnresolved} \\|`));
    assert.match(report,/No result object was supplied/);
    assert.match(report,/NO_RESULT_RECORD/);
    assert.match(report,/Development control calibration and bindings/);
    assert.match(report,/FROZEN\\_DEVELOPMENT\\_ONLY/);
    assert.match(report,/primaryDevelopmentSha256/);
    assert.match(report,/fullBasketDevelopmentSha256/);
    assert.ok(report.includes(envelope.job.controlBindings.primaryDevelopmentSha256));
    assert.ok(report.includes(envelope.job.controlBindings.fullBasketDevelopmentSha256));
    assert.equal(inventoryLines(report).length,44);
  }
});

test('queued export keeps all 44 identity slots while result and controls remain absent',async()=>{
  const report=await renderReviewReport(encode(await queuedEnvelope()));
  assert.match(report,/No result object was supplied/);
  assert.match(report,/No progress observations were supplied/);
  assert.match(report,/NO_RESULT_RECORD/);
  assert.match(report,/\\| controls \\| null \\|/);
  assert.match(report,/\\| controlBindings \\| null \\|/);
  assert.equal(inventoryLines(report).length,44);
});

test('public parser rejects invalid digest, duplicate keys, invalid UTF-8, and malformed bytes',async()=>{
  const {completed}=await generatedExports();
  const badDigest=structuredClone(completed);
  badDigest.payloadSha256='0'.repeat(64);
  await assert.rejects(renderReviewReport(encode(badDigest)),{message:'REPORT_INPUT_INVALID'});

  const duplicateKey=encode(completed).toString('utf8')
    .replace(`"schema":"${HISTORICAL_EXPORT_SCHEMA}"`,
      `"schema":"${HISTORICAL_EXPORT_SCHEMA}","schema":"${HISTORICAL_EXPORT_SCHEMA}"`);
  await assert.rejects(renderReviewReport(Buffer.from(duplicateKey)),{message:'REPORT_INPUT_INVALID'});
  await assert.rejects(renderReviewReport(new Uint8Array([0xff])),{message:'REPORT_INPUT_INVALID'});
  await assert.rejects(renderReviewReport(Buffer.from('{')),{message:'REPORT_INPUT_INVALID'});
  await assert.rejects(renderReviewReport(new Uint8Array(MAX_HISTORICAL_EXPORT_BYTES+1)),
    {message:'REPORT_INPUT_LIMIT'});
});

test('hostile Markdown, HTML, and URL text remains inert; direct formatter enforces its output guard',async()=>{
  const {completed}=await generatedExports();
  const projection=await parseArenaHistoricalExport(encode(completed));
  projection.job.trialKey='![x](https://bad.example) <img src=x onerror=alert(1)> | `code`';
  const report=renderParsedReviewReport(projection);
  assert.doesNotMatch(report,/<img|<script|\]\(|!\[/i);
  assert.doesNotMatch(report,/https:\/\/bad\.example/);
  assert.ok(report.includes('&lt;img'));
  assert.ok(report.includes('\\|'));

  projection.job.trialKey='x'.repeat(MAX_REVIEW_REPORT_BYTES);
  assert.throws(()=>renderParsedReviewReport(projection),{message:'REPORT_OUTPUT_LIMIT'});
});

test('report module has no engine, file, network, or journal dependency',()=>{
  const source=readFileSync(new URL(
    '../scripts/research/b1-7/render-review-report.mjs',import.meta.url
  ),'utf8');
  assert.doesNotMatch(source,/from ['"][^'"]*(?:engine|journal|captured-input|supervisor)\.mjs/);
  assert.doesNotMatch(source,/\b(?:fetch|readFileSync|writeFileSync|createExecution|runBatch)\s*\(/);
});

test('CLI emits complete accepted reports and empty stdout for rejected inputs',async()=>{
  const {completed,insufficient}=await generatedExports();
  const script=new URL('../scripts/research/b1-7/render-review-report.mjs',import.meta.url);
  const completedRun=spawnSync(process.execPath,[script.pathname],{
    input:encode(completed),encoding:'utf8'
  });
  assert.equal(completedRun.status,0,completedRun.stderr);
  assert.equal(completedRun.stderr,'');
  assert.equal(completedRun.stdout,await renderReviewReport(encode(completed)));

  const insufficientRun=spawnSync(process.execPath,[script.pathname],{
    input:encode(insufficient),encoding:'utf8'
  });
  assert.equal(insufficientRun.status,0,insufficientRun.stderr);
  assert.match(insufficientRun.stdout,/NOT\\_RUN\\_INSUFFICIENT\\_EVIDENCE/);
  assert.equal(inventoryLines(insufficientRun.stdout).length,44);

  const duplicateKey=encode(completed).toString('utf8')
    .replace(`"schema":"${HISTORICAL_EXPORT_SCHEMA}"`,
      `"schema":"${HISTORICAL_EXPORT_SCHEMA}","schema":"${HISTORICAL_EXPORT_SCHEMA}"`);
  for(const [args,input,expected] of [
    [[script.pathname,'unexpected'],encode(completed),'REPORT_ARGUMENTS_INVALID'],
    [[script.pathname],Buffer.from(duplicateKey),'REPORT_INPUT_INVALID'],
    [[script.pathname],Buffer.from([0xff]),'REPORT_INPUT_INVALID'],
    [[script.pathname],Buffer.alloc(MAX_HISTORICAL_EXPORT_BYTES+1),'REPORT_INPUT_LIMIT']
  ]){
    const failed=spawnSync(process.execPath,args,{input,encoding:'utf8',maxBuffer:1024*1024});
    assert.notEqual(failed.status,0);
    assert.equal(failed.stdout,'');
    assert.equal(failed.stderr,`ERROR ${expected}\n`);
  }
});
