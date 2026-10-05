import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_VENUE_FUNDING_EDGE_V1_STAGE_LOCK as x} from '../research/cross-venue-funding-edge-v1-stage-lock.js';

test('Cross-Venue Funding Edge V1 is permanently closed after source failure',()=>{
  assert.equal(x.ruleset,'CROSS-VENUE-FUNDING-EDGE-V1');
  assert.equal(x.stage,'SOURCE_CLOSED');
  assert.equal(x.sourceAudit,false);
  assert.equal(x.discovery,false);
  assert.equal(x.validation,false);
  assert.equal(x.holdout,false);
  assert.equal(x.paper,false);
  assert.equal(x.live,false);
  assert.equal(x.decision,'CROSS_VENUE_V1_SOURCE_FAIL');
  assert.equal(x.evidenceMainSha,'a52c56010b9a547061c82d37840f5335465b3754');
  assert.equal(x.evidenceRunId,37270798106);
  assert.equal(x.blockerIssue,528);
});
