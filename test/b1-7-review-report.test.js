import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import bridgeManifest from '../scripts/research-supervisor/b1_bridge_manifest.json' with {type:'json'};
import {
  canonicalHistoricalExportPayload, HISTORICAL_EXPORT_PURPOSE, HISTORICAL_EXPORT_SCHEMA,
  MAX_HISTORICAL_EXPORT_BYTES
} from '../v11/arena-historical-export.js';
import {
  MAX_REVIEW_REPORT_BYTES, renderParsedReviewReport, renderReviewReport
} from '../scripts/research/b1-7/render-review-report.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const computationPathIds = () => bridgeManifest.computationOrder.map(index=>bridgeManifest.pathIds[index]);
const inventoryLines = report => report.split('## Path identity inventory — manifest order')[1]
  .split('## Computation order')[0].split('\n')
  .filter(line=>/^\| \d+ \| [a-f0-9]{64} \|/.test(line));

async function queuedEnvelopeBytes() {
  const trialKey = 'trial-review-report-generated';
  const job = {
    trialId:digest(Buffer.from(trialKey)),
    trialKey,
    state:'queued',
    attempts:0,
    owner:null,
    fence:0,
    profile:bridgeManifest.profile,
    protocolSha256:bridgeManifest.protocolSha256,
    sourceSha256:'bab379ce692601315ef3b0436ac7969798e96cc9781f7f3845ec4ed8a2b770e7',
    dataSha256:bridgeManifest.inputSha256,
    manifestSha256:bridgeManifest.manifestSha256,
    pathIds:bridgeManifest.pathIds,
    computationPathIds:computationPathIds(),
    timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:null,finishedAt:null},
    paths:[],
    controls:null,
    controlBindings:null,
    result:null,
    resultSha256:null,
    summarySha256:null,
    reason:null,
    unresolved:false,
    executionAuthorized:false,
    promotionAuthorized:false,
    profitabilityInferred:false
  };
  const envelope = {
    schema:HISTORICAL_EXPORT_SCHEMA,
    purpose:HISTORICAL_EXPORT_PURPOSE,
    provenance:{
      source:'CALLER_SUPPLIED_INSPECT_B1',
      assertionStatus:'UNVERIFIED',
      sourceAuthenticity:'NOT_ESTABLISHED',
      syntheticFixture:true
    },
    job,
    payloadSha256:'0'.repeat(64)
  };
  envelope.payloadSha256 = digest(Buffer.from(canonicalHistoricalExportPayload(envelope),'ascii'));
  return Buffer.from(JSON.stringify(envelope));
}

function parsedProjection({resultStatus='COMPLETED',screenStatus='INSUFFICIENT_EVIDENCE'}={}) {
  const job = {
    trialId:'a'.repeat(64),trialKey:'trial-synthetic-render-fixture',state:'completed',
    attempts:1,owner:'generated-fixture',fence:1,profile:bridgeManifest.profile,
    protocolSha256:bridgeManifest.protocolSha256,sourceSha256:'b'.repeat(64),
    dataSha256:bridgeManifest.inputSha256,manifestSha256:bridgeManifest.manifestSha256,
    pathIds:bridgeManifest.pathIds,computationPathIds:computationPathIds(),
    timestamps:{createdAt:'2026-01-01T00:00:00Z',startedAt:'2026-01-01T00:00:01Z',
      finishedAt:'2026-01-01T00:00:02Z'},
    paths:[],controls:null,controlBindings:null,result:null,resultSha256:'c'.repeat(64),
    summarySha256:'d'.repeat(64),reason:null,unresolved:false,
    executionAuthorized:false,promotionAuthorized:false,profitabilityInferred:false
  };
  const insufficient = resultStatus === 'INSUFFICIENT_EVIDENCE';
  const paths = bridgeManifest.pathDescriptors.map((descriptor,index) => ({
    pathId:job.pathIds[index],
    kind:descriptor[0],variantId:descriptor[1],scenarioId:descriptor[2],segmentId:descriptor[3],
    ...(insufficient && index >= 19
      ? {status:'NOT_RUN_INSUFFICIENT_EVIDENCE',computed:false,attempts:0,failure:null}
      : {
        status:'COMPLETED',computed:true,attempts:1,
        rows:descriptor[3]==='development'?180:365,dailyReturnCount:descriptor[3]==='development'?180:365,
        dailyReturnSd:0, startEquity:10000,endEquity:10000,meanHeldTarget:0,
        meanRealizedExposure:0,meanTargetRealizedMismatch:0,meanAbsoluteTargetMismatch:0,
        maxAbsoluteTargetMismatch:0,maxConcentration:0,maxDrawdownDuration:0,
        netReturn:0,sampledDrawdown:0,totalCosts:0,turnoverNotional:0,
        turnoverOnInitialEquity:0,fillCostCount:0,cancelledInstructionCount:0,
        diagnosticRescaling:'NONE',observationClass:'HISTORICAL_DIAGNOSTIC_NOT_HOLDOUT',
        tradeCRV:{status:'UNDEFINED_NO_FINITE_STOP',value:null,promotionEligible:false},
        ...(descriptor[0]==='CANDIDATE'?{}:{targetExposure:0}),
        quarterlyReturns:descriptor[3]==='development'
          ? [{quarter:'2025-Q2',netReturn:0},{quarter:'2025-Q3',netReturn:0}]
          : [{quarter:'2025-Q4',netReturn:0},{quarter:'2026-Q1',netReturn:0},
            {quarter:'2026-Q2',netReturn:0},{quarter:'2026-Q3',netReturn:0}]
      })
  }));
  const result = {
    attemptedPaths:insufficient?19:44,
    authority:{researchOnly:true,executionAuthorized:false,strategyPnlAuthorized:false,
      discoveryAuthorized:false,validationAuthorized:false,holdoutAuthorized:false,
      paperAuthorized:false,liveAuthorized:false},
    budget:{outputBytes:1048576},
    completedPaths:insufficient?19:44,
    computedPaths:insufficient?19:44,
    controlRealization:[],
    evidence:{syntheticFixture:true,sourceAuthenticity:'SYNTHETIC_ONLY',holdoutClaim:false,
      costModel:'OKX_INSPIRED_ASSUMED_15_30BP_NOT_EXECUTION_EVIDENCE',
      stoppedPolicy:'NO_FINITE_TRADE_STOP',trialLedger:'UNKNOWN'},
    executionId:'e'.repeat(64),failure:null,
    identity:{datasetKind:'SYNTHETIC_FIXTURE',inputSha256:bridgeManifest.inputSha256},
    implementationId:bridgeManifest.implementationId,
    implementationSha256:bridgeManifest.implementationSha256,
    plannedPaths:44,protocolId:bridgeManifest.protocolId,protocolReview:{},
    protocolSha256:bridgeManifest.protocolSha256,schema:'MERIDIAN_B1_7_ENGINE_RESULT_R3',
    screen:screenStatus==='INSUFFICIENT_EVIDENCE'
      ? {status:screenStatus,checks:{fullBasketDrawdownDenominator:false},relativeDrawdownReduction:null}
      : {status:screenStatus},
    status:resultStatus,controlDefinitions:{status:'FROZEN_DEVELOPMENT_ONLY'},paths
  };
  return {
    status:'PRESENT_UNVERIFIED',
    purpose:HISTORICAL_EXPORT_PURPOSE,
    provenance:{source:'CALLER_SUPPLIED_INSPECT_B1',assertionStatus:'UNVERIFIED',
      sourceAuthenticity:'NOT_ESTABLISHED',syntheticFixture:true},
    job,result
  };
}

test('accepted synthetic export renders deterministically without changing input and keeps all inventory IDs',async()=>{
  const bytes = await queuedEnvelopeBytes();
  const before = Buffer.from(bytes);
  const first = await renderReviewReport(bytes);
  const second = await renderReviewReport(bytes);
  assert.equal(first,second);
  assert.deepEqual(bytes,before);
  assert.match(first,/SYNTHETIC\-ONLY EXPORT CONTRACT/);
  assert.match(first,/No result object was supplied/);
  assert.match(first,/NO_RESULT_RECORD/);
  assert.equal(inventoryLines(first).length,44);
  for(const id of bridgeManifest.pathIds) assert.ok(first.includes(id));
  assert.equal(Buffer.byteLength(first),Buffer.byteLength(first,'utf8'));
});

test('separate report inventory, progress, engine status, screen status, and exact returned quarters',()=>{
  const projection = parsedProjection();
  const before = structuredClone(projection);
  const report = renderParsedReviewReport(projection);
  assert.deepEqual(projection,before);
  assert.match(report,/engineStatus/);
  assert.match(report,/COMPLETED/);
  assert.match(report,/screenStatus/);
  assert.ok(report.includes('INSUFFICIENT\\_EVIDENCE'));
  assert.match(report,/sourceAuthenticity/);
  assert.ok(report.includes('NOT\\_ESTABLISHED'));
  assert.match(report,/holdoutAuthorized/);
  assert.match(report,/false/);
  assert.ok(report.includes('NO\\_FINITE\\_TRADE\\_STOP'));
  assert.match(report,/2025\\-Q2/);
  assert.ok(report.includes('netReturn\\"\\:0'));
  assert.ok(report.includes('dailyReturnSd\\"\\:0'));
  assert.ok(report.includes('promotionEligible'));
  assert.ok(report.includes('value\\"\\:null'));
  assert.equal(inventoryLines(report).length,44);
});

test('early insufficient result preserves 19 returned paths and 25 explicit no-run records',()=>{
  const report = renderParsedReviewReport(parsedProjection({
    resultStatus:'INSUFFICIENT_EVIDENCE',screenStatus:'INSUFFICIENT_EVIDENCE'
  }));
  const rows = inventoryLines(report);
  assert.equal(rows.length,44);
  assert.equal(rows.filter(line=>line.includes('COMPLETED')).length,19);
  assert.equal(rows.filter(line=>line.includes('NOT\\_RUN\\_INSUFFICIENT\\_EVIDENCE')).length,25);
  assert.ok(report.includes('computed\\"\\:false'));
});

test('hostile Markdown, HTML, and URL text remains inert and output overflow is rejected',()=>{
  const projection = parsedProjection();
  projection.job.trialKey = '![x](https://bad.example) <img src=x onerror=alert(1)> | `code`';
  const report = renderParsedReviewReport(projection);
  assert.doesNotMatch(report,/<img|<script|\]\(|!\[/i);
  assert.doesNotMatch(report,/https:\/\/bad\.example/);
  assert.ok(report.includes('&lt;img'));
  assert.ok(report.includes('\\|'));

  projection.job.trialKey = 'x'.repeat(MAX_REVIEW_REPORT_BYTES);
  assert.throws(()=>renderParsedReviewReport(projection),{message:'REPORT_OUTPUT_LIMIT'});
});

test('parser rejects malformed bytes and report module has no execution, file, network, or journal dependency',async()=>{
  await assert.rejects(renderReviewReport(new Uint8Array(MAX_HISTORICAL_EXPORT_BYTES+1)),
    {message:'REPORT_INPUT_LIMIT'});
  await assert.rejects(renderReviewReport(new Uint8Array([0xff])),{message:'REPORT_INPUT_INVALID'});
  await assert.rejects(renderReviewReport(Buffer.from('{')),{message:'REPORT_INPUT_INVALID'});

  const source = readFileSync(new URL('../scripts/research/b1-7/render-review-report.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"][^'"]*(?:engine|journal|captured-input|supervisor)\.mjs/);
  assert.doesNotMatch(source,/\b(?:fetch|readFileSync|writeFileSync|createExecution|runBatch)\s*\(/);
});

test('CLI emits only a complete report, uses generic errors, and rejects arguments',async()=>{
  const bytes = await queuedEnvelopeBytes();
  const script = new URL('../scripts/research/b1-7/render-review-report.mjs',import.meta.url);
  const valid = spawnSync(process.execPath,[script.pathname],{input:bytes,encoding:'utf8'});
  assert.equal(valid.status,0,valid.stderr);
  assert.equal(valid.stderr,'');
  assert.match(valid.stdout,/Offline B1 review report/);
  assert.equal(valid.stdout,await renderReviewReport(bytes));

  for(const [args,input,expected] of [
    [[script.pathname,'unexpected'],bytes,'REPORT_ARGUMENTS_INVALID'],
    [[script.pathname],Buffer.from('{'),'REPORT_INPUT_INVALID'],
    [[script.pathname],Buffer.alloc(MAX_HISTORICAL_EXPORT_BYTES+1),'REPORT_INPUT_LIMIT']
  ]) {
    const failed = spawnSync(process.execPath,args,{input,encoding:'utf8',maxBuffer:1024*1024});
    assert.notEqual(failed.status,0);
    assert.equal(failed.stdout,'');
    assert.equal(failed.stderr,`ERROR ${expected}\n`);
  }
});
