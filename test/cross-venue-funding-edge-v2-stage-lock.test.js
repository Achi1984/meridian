import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_VENUE_FUNDING_EDGE_V2_STAGE_LOCK as x} from '../research/cross-venue-funding-edge-v2-stage-lock.js';

test('Cross-Venue Funding Edge V2 is preregistered but source audit remains locked',()=>{
  assert.equal(x.ruleset,'CROSS-VENUE-FUNDING-EDGE-V2');
  assert.equal(x.stage,'PREREGISTERED');
  assert.equal(x.sourceAudit,false);
  assert.equal(x.discovery,false);
  assert.equal(x.validation,false);
  assert.equal(x.holdout,false);
  assert.equal(x.paper,false);
  assert.equal(x.live,false);
  assert.equal(x.predecessor,'CROSS-VENUE-FUNDING-EDGE-V1');
  assert.equal(x.predecessorDecision,'CROSS_VENUE_V1_SOURCE_FAIL');
});
