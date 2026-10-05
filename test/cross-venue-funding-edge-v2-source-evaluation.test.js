import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK as lock} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

const evaluation=JSON.parse(fs.readFileSync(new URL('../research/cross-venue-funding-edge-v2-source-evaluation.json',import.meta.url),'utf8'));
const decision=fs.readFileSync(new URL('../research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-EVALUATION.md',import.meta.url),'utf8');

test('canonical V2 source evaluation persists exact run artifact and receipt identity',()=>{
  assert.equal(evaluation.schema,'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-EVALUATION-1');
  assert.equal(evaluation.ruleset,'CROSS-VENUE-FUNDING-EDGE-V2');
  assert.equal(evaluation.stage,'SOURCE_AUDIT');
  assert.equal(evaluation.sourceAuditOutcome,'VALID_WITH_INTEGRITY_EPISODES');
  assert.equal(evaluation.sourceAuditFinal,true);
  assert.equal(evaluation.strategyPnlCalculated,false);
  assert.equal(evaluation.canonicalSourceRun.runId,37290831222);
  assert.equal(evaluation.canonicalSourceRun.runAttempt,1);
  assert.equal(evaluation.canonicalSourceRun.sourceJobId,111700620728);
  assert.equal(evaluation.canonicalSourceRun.commitSha,'63f93aa41b6e054b229309b6fd6fbc2447a92181');
  assert.equal(evaluation.canonicalSourceRun.artifactId,11336541442);
  assert.equal(evaluation.canonicalSourceRun.artifactZipSha256,'97bf9772ed10e741d5a2a0de64ccde7e4dec703178f1b662796b0ce7f3258a32');
  assert.equal(evaluation.canonicalSourceRun.sourcePackageSha256,'a2bb7802a6c6b4298466d16e0225ef616fe36ae2d85ac4af9d020127be4ce91b');
  assert.equal(evaluation.canonicalSourceRun.receiptDigest,'822a42728e8f9c1da61059eb31d10fea9771adac34042dfede6fa9f3e63845d5');
  assert.equal(evaluation.canonicalSourceRun.classification,'FINAL_SOURCE_SEMANTIC_RESULT');
  assert.equal(evaluation.canonicalSourceRun.retriesUsed,0);
});

test('canonical V2 source evaluation preserves source-only counts split and integrity episode',()=>{
  assert.equal(evaluation.sourceSummary.commonFundingDecisions,5019);
  assert.equal(evaluation.sourceSummary.integrityEventCount,3);
  assert.deepEqual(
    evaluation.integrityEvents.map(x=>x.kind),
    ['FUNDING_GAP','MISSING_SCHEDULED_FUNDING','OFF_GRID_FUNDING']
  );
  assert.ok(evaluation.integrityEvents.every(x=>x.venue==='OKX'));
  assert.equal(evaluation.sourceSummary.split.discovery.count,3011);
  assert.equal(evaluation.sourceSummary.split.validation.count,1004);
  assert.equal(evaluation.sourceSummary.split.holdout.count,1004);
  assert.equal(evaluation.interpretation.sourceContractValid,true);
  assert.equal(evaluation.interpretation.sourceAuditEvidenceAccepted,true);
  assert.equal(evaluation.interpretation.discoveryAuthorized,false);
  assert.equal(evaluation.interpretation.strategyPnlAuthorized,false);
  assert.equal(evaluation.interpretation.laterStageTransitionAuthorized,false);
});

test('source evaluation does not advance the V2 stage or authorize PnL',()=>{
  assert.equal(lock.stage,'SOURCE_AUDIT');
  assert.equal(lock.sourceAudit,true);
  assert.equal(lock.discovery,false);
  assert.equal(lock.validation,false);
  assert.equal(lock.holdout,false);
  assert.equal(lock.paper,false);
  assert.equal(lock.live,false);
});

test('source evaluation decision records finality and remaining runner prerequisites',()=>{
  assert.match(decision,/VALID_WITH_INTEGRITY_EPISODES/);
  assert.match(decision,/No transport retry occurred/);
  assert.match(decision,/retrying the canonical run to seek another result is forbidden/);
  assert.match(decision,/V2 remains at `SOURCE_AUDIT`/);
  assert.match(decision,/`entryActive` must be strict boolean/);
  assert.match(decision,/deterministic episode state machine/);
  assert.match(decision,/independent cash\/equity ledger construction/);
  assert.match(decision,/generic causality tests across event types/);
  assert.match(decision,/strategy PnL calculated: \*\*false\*\*/);
});
