import test from 'node:test';
import assert from 'node:assert/strict';
import { challengerV3Decision, CHALLENGER_V3_RULESET } from '../challenger-v3.js';

const base={side:'LONG',entry:100,sl:98,tp1:102.8,tp2:104.4,technical:90,candidate:90,distanceAtr:.35,regime:'BULL'};

test('Challenger V3 has no Baseline READY hard dependency',()=>{
  const r=challengerV3Decision({...base,status:'NO_SETUP'});
  assert.equal(r.ruleset,CHALLENGER_V3_RULESET);
  assert.equal(r.baselineReadyDependency,false);
  assert.ok(['TRADE','CAUTION'].includes(r.decision));
  assert.ok(r.reasons.includes('BASELINE_STATUS_SOFT_ONLY'));
});

test('WAIT_ENTRY_ZONE is soft evidence, not a hard block',()=>{
  const r=challengerV3Decision({...base,status:'WAIT_ENTRY_ZONE',distanceAtr:1.05});
  assert.notEqual(r.decision,'SKIP');
  assert.equal(r.baselineStatusAdjustment,-3);
});

test('weak evidence still skips through confidence instead of status gate',()=>{
  const r=challengerV3Decision({...base,status:'READY',technical:50,candidate:50,distanceAtr:2.5,regime:'BEAR'});
  assert.equal(r.decision,'SKIP');
  assert.ok(r.reasons.includes('CONFIDENCE_LT_CAUTION'));
});

test('invalid geometry remains a true safety gate',()=>{
  const r=challengerV3Decision({...base,sl:null,status:'NO_SETUP'});
  assert.equal(r.decision,'SKIP');
  assert.deepEqual(r.reasons,['INVALID_SIGNAL']);
});
