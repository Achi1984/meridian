import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {v2SourceCollectionGate} from '../research/cross-venue-funding-edge-v2-source-gate.js';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const clone=x=>structuredClone(x);

const liveEvaluation=readJson('research/cross-venue-funding-edge-v2-source-evaluation.json');
const liveResume=readJson('MERIDIAN_RESUME.json');
const liveState=readJson('MERIDIAN_AGENT_STATE.json');
const liveV2=liveResume.canonicalResearch.crossVenueFundingEdgeV2;
const liveAgent=liveState.researchCheckpoint;

function preEval(){
  return{
    stageLock:{ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',sourceAudit:true},
    evaluation:null,
    resumeV2:{sourceAuditEvaluated:false},
    agentCheckpoint:{}
  };
}
function finalFixture(){
  return{
    stageLock:{ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',sourceAudit:true},
    evaluation:clone(liveEvaluation),
    resumeV2:clone(liveV2),
    agentCheckpoint:clone(liveAgent)
  };
}

test('S1 sourceAudit true without final evaluation collects canonical source',()=>{
  assert.equal(v2SourceCollectionGate(preEval()),'COLLECT_CANONICAL_SOURCE');
});

test('S2 valid final evaluation matching Resume and Agent skips source collection',()=>{
  assert.equal(v2SourceCollectionGate(finalFixture()),'SOURCE_FINAL_SKIP');
});

test('S3 final source fail is final too and cannot become a rescue collection',()=>{
  const x=finalFixture();
  x.evaluation.sourceAuditOutcome='CROSS_VENUE_V2_SOURCE_FAIL';
  x.resumeV2.sourceAuditOutcome='CROSS_VENUE_V2_SOURCE_FAIL';
  assert.equal(v2SourceCollectionGate(x),'SOURCE_FINAL_SKIP');
});

test('S4 sourceAudit false is locked skip when continuity is consistent',()=>{
  const x=finalFixture();x.stageLock.sourceAudit=false;
  assert.equal(v2SourceCollectionGate(x),'SOURCE_LOCKED_SKIP');
  const pre=preEval();pre.stageLock.sourceAudit=false;
  assert.equal(v2SourceCollectionGate(pre),'SOURCE_LOCKED_SKIP');
});

test('S5 missing evaluation while continuity claims final is invalid',()=>{
  const x=finalFixture();x.evaluation=null;
  assert.throws(()=>v2SourceCollectionGate(x),/EVALUATION_MISSING_BUT_CONTINUITY_FINAL/);
});

test('S6 every canonical Evaluation vs Resume identity field mismatch fails closed',()=>{
  const fields=['runId','runAttempt','commitSha','artifactId','receiptDigest','artifactZipSha256','sourcePackageSha256'];
  for(const field of fields){
    const x=finalFixture();
    if(typeof x.resumeV2.canonicalSourceRun[field]==='number')x.resumeV2.canonicalSourceRun[field]+=1;
    else x.resumeV2.canonicalSourceRun[field]=(field==='commitSha'?'f'.repeat(40):'f'.repeat(64));
    assert.throws(()=>v2SourceCollectionGate(x),/INVALID_STATE/,field);
  }
});

test('S7 Agent runId or receipt mismatch against canonical evidence fails closed',()=>{
  for(const field of ['runId','receiptDigest']){
    const x=finalFixture();
    x.agentCheckpoint.canonicalSourceRun[field]=field==='runId'
      ?x.agentCheckpoint.canonicalSourceRun[field]+1
      :'f'.repeat(64);
    assert.throws(()=>v2SourceCollectionGate(x),/INVALID_STATE/,field);
  }
});

test('S8 sourceAuditFinal must be literal boolean true',()=>{
  for(const bad of [false,'true',undefined,null,1]){
    const x=finalFixture();x.evaluation.sourceAuditFinal=bad;
    assert.throws(()=>v2SourceCollectionGate(x),/EVALUATION_NOT_FINAL/);
  }
});

test('S9 PnL or later-stage authorization flags cannot coexist with final source seal',()=>{
  for(const [pathKey,bad] of [
    ['strategyPnlCalculated',true],
    ['discoveryAuthorized',true],
    ['strategyPnlAuthorized',true],
    ['laterStageTransitionAuthorized',true]
  ]){
    const x=finalFixture();
    if(pathKey==='strategyPnlCalculated')x.evaluation[pathKey]=bad;
    else x.evaluation.interpretation[pathKey]=bad;
    assert.throws(()=>v2SourceCollectionGate(x),/INVALID_STATE/,pathKey);
  }
});

test('S10 unknown outcome schema ruleset or stage fails closed',()=>{
  for(const mutate of [
    x=>x.evaluation.sourceAuditOutcome='UNKNOWN',
    x=>x.evaluation.schema='BAD',
    x=>x.evaluation.ruleset='BAD',
    x=>x.evaluation.stage='DISCOVERY'
  ]){
    const x=finalFixture();mutate(x);
    assert.throws(()=>v2SourceCollectionGate(x),/INVALID_STATE/);
  }
});

test('S11 stage lock ruleset and sourceAudit type are strict',()=>{
  const a=preEval();a.stageLock.sourceAudit='true';
  assert.throws(()=>v2SourceCollectionGate(a),/STAGE_LOCK_SOURCE_AUDIT_TYPE/);
  const b=preEval();b.stageLock.ruleset='OTHER';
  assert.throws(()=>v2SourceCollectionGate(b),/STAGE_LOCK_RULESET/);
});

test('S12 current repository state is sealed SOURCE_FINAL_SKIP',()=>{
  assert.equal(v2SourceCollectionGate({
    stageLock:CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK,
    evaluation:liveEvaluation,
    resumeV2:liveV2,
    agentCheckpoint:liveAgent
  }),'SOURCE_FINAL_SKIP');
});

test('S13 workflow has exact sealed gate condition and no manual or scheduled trigger',()=>{
  const yaml=read('.github/workflows/cross-venue-funding-edge-v2-source.yml');
  assert.match(yaml,/source_gate:\s*\$\{\{ steps\.gate\.outputs\.source_gate \}\}/);
  assert.match(yaml,/needs\.invariants\.outputs\.source_gate == 'COLLECT_CANONICAL_SOURCE'/);
  assert.match(yaml,/github\.event_name == 'push'/);
  assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(yaml,/workflow_dispatch\s*:/);
  assert.doesNotMatch(yaml,/schedule\s*:/);
  const guardAt=yaml.indexOf('Frozen research lineage');
  const gateAt=yaml.indexOf('Compute V2 source gate');
  assert.ok(guardAt>=0&&gateAt>guardAt,'Frozen Guard must run before source gate computation');
});

test('S14 gate helper is pure and cannot access network processes or Actions API',()=>{
  const source=read('research/cross-venue-funding-edge-v2-source-gate.js');
  assert.doesNotMatch(source,/\bfetch\s*\(/);
  assert.doesNotMatch(source,/child_process|exec\s*\(|spawn\s*\(/);
  assert.doesNotMatch(source,/api\.github\.com|actions\/artifacts|workflow_runs/i);
});

test('S15 frozen stage/evaluation identity and canonical receipt remain unchanged',()=>{
  const guard=read('scripts/frozen-research-guard.mjs');
  assert.match(guard,/'research\/cross-venue-funding-edge-v2-stage-lock\.js':'9ceb94c5a14f56284cd0e473707d6106819ccf80'/);
  assert.match(guard,/'research\/cross-venue-funding-edge-v2-source-evaluation\.json':'0cc60ce3dbee82d8f334074269832bcdc9e761f8'/);
  assert.equal(liveEvaluation.canonicalSourceRun.runId,37290831222);
  assert.equal(liveEvaluation.canonicalSourceRun.receiptDigest,'822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5');
});

test('S16 source sealing changes no research-stage or PnL authorization',()=>{
  assert.equal(liveV2.stage,'SOURCE_AUDIT');
  assert.equal(liveV2.discoveryAuthorized,false);
  assert.equal(liveV2.validationAuthorized,false);
  assert.equal(liveV2.holdoutAuthorized,false);
  assert.equal(liveV2.strategyPnlAuthorized,false);
  assert.equal(liveAgent.strategyPnlObserved,false);
});
