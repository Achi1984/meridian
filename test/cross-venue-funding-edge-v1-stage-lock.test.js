import test from 'node:test';
import assert from 'node:assert/strict';
import {CROSS_VENUE_FUNDING_EDGE_V1_STAGE_LOCK as x} from '../research/cross-venue-funding-edge-v1-stage-lock.js';

test('Cross-Venue Funding Edge V1 authorizes source audit only',()=>{
  assert.equal(x.stage,'SOURCE_AUDIT');
  assert.equal(x.sourceAudit,true);
  assert.equal(x.discovery,false);
  assert.equal(x.validation,false);
  assert.equal(x.holdout,false);
  assert.equal(x.paper,false);
  assert.equal(x.live,false);
});
