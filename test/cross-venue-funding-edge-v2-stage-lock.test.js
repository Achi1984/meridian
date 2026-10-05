import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK as x} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

test('Cross-Venue Funding Edge V2 authorizes source audit only',()=>{
  assert.equal(x.ruleset,'CROSS-VENUE-FUNDING-EDGE-V2');
  assert.equal(x.stage,'SOURCE_AUDIT');
  assert.equal(x.sourceAudit,true);
  assert.equal(x.discovery,false);
  assert.equal(x.validation,false);
  assert.equal(x.holdout,false);
  assert.equal(x.paper,false);
  assert.equal(x.live,false);
  assert.equal(x.predecessor,'CROSS-VENUE-FUNDING-EDGE-V1');
  assert.equal(x.predecessorDecision,'CROSS_VENUE_V1_SOURCE_FAIL');
});

test('V2 source-audit authorization freezes canonical evidence retry and persistence rules',()=>{
  const doc=fs.readFileSync(new URL('../research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-AUTHORIZATION.md',import.meta.url),'utf8');
  assert.match(doc,/first V2 source workflow run triggered by the merge commit/);
  assert.match(doc,/before `validateCrossVenueV2Source` produces a result/);
  assert.match(doc,/same canonical workflow run on the same merge commit/);
  assert.match(doc,/two retries after the initial attempt/);
  assert.match(doc,/three total attempts/);
  assert.match(doc,/CROSS_VENUE_V2_SOURCE_FAIL/);
  assert.match(doc,/different commit is diagnostic and cannot replace the canonical source evidence/);
  assert.match(doc,/receipt digest is exactly identical to the canonical receipt digest/);
  assert.match(doc,/CROSS_VENUE_V2_SOURCE_DETERMINISM_FAILURE/);
  assert.match(doc,/canonical `runId`, `runAttempt`, merge `commitSha`, `artifactId` and `receiptDigest`/);
  assert.match(doc,/Until that evaluation PR is merged, V2 remains at `SOURCE_AUDIT`/);
});
