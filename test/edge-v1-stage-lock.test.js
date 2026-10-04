import test from 'node:test';
import assert from 'node:assert/strict';
import {EDGE_V1_STAGE_LOCK as x} from '../research/edge-v1-stage-lock.js';

test('Paper Edge V1 is permanently closed after failed Discovery',()=>{
  assert.equal(x.stage,'DISCOVERY_CLOSED');
  assert.equal(x.discovery,false);
  assert.equal(x.validation,false);
  assert.equal(x.holdout,false);
  assert.equal(x.live,false);
  assert.equal(x.decision,'EDGE_V1_DISCOVERY_FAIL');
  assert.equal(x.resultDigest,'e04e812ab59b5b084dcdd8f15fa7aa58c55df15e22f028c2f6cf2266b06f1abd');
  assert.equal(x.evidenceRunId,37233479311);
  assert.equal(x.evidenceArtifactId,11314304791);
});
