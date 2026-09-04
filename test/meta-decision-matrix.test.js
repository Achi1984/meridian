import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBotDecisionMatrix, attachMatrixOutcome, matrixCohortSummary, __test } from '../meta-decision-matrix.js';

test('normalizes heterogeneous bot decisions',()=>{
  assert.equal(__test.normalizeDecision('baseline',{status:'READY',side:'LONG'}).action,'TRADE');
  assert.equal(__test.normalizeDecision('shadow',{decision:'BLOCK',side:'LONG'}).action,'SKIP');
  assert.equal(__test.normalizeDecision('challenger',{decision:'CAUTION',side:'SHORT'}).action,'CAUTION');
});

test('matrix captures agreement and side conflict without routing',()=>{
  const m=buildBotDecisionMatrix({symbol:'BTCUSDT',baseline:{status:'READY',side:'LONG'},shadow:{decision:'BLOCK',side:'LONG'},challenger:{decision:'TRADE',side:'LONG',confidence:78},regime:{decision:'TRADE',side:'SHORT',score:81}});
  assert.equal(m.researchOnly,true);
  assert.equal(m.executionImpact,false);
  assert.equal(m.disagreement.sideConflict,true);
  assert.equal(m.disagreement.hardDisagreement,true);
  assert.equal(m.direction.long,2);
  assert.equal(m.direction.short,1);
  assert.equal(m.outcome,null);
});

test('outcome summary separates conflict from full directional agreement',()=>{
  const aligned=attachMatrixOutcome(buildBotDecisionMatrix({symbol:'ETHUSDT',baseline:{status:'READY',side:'LONG'},shadow:{decision:'TRADE',side:'LONG'},challenger:{decision:'TRADE',side:'LONG'},regime:{decision:'CAUTION',side:'LONG'}}),{realizedR:1});
  const conflict=attachMatrixOutcome(buildBotDecisionMatrix({symbol:'SOLUSDT',baseline:{status:'READY',side:'LONG'},shadow:{decision:'SKIP',side:'LONG'},challenger:{decision:'TRADE',side:'LONG'},regime:{decision:'TRADE',side:'SHORT'}}),{realizedR:-1});
  const s=matrixCohortSummary([aligned,conflict]);
  assert.equal(s.n,2);
  assert.equal(s.fullDirectionalAgreement.n,1);
  assert.equal(s.fullDirectionalAgreement.avgR,1);
  assert.equal(s.sideConflict.n,1);
  assert.equal(s.sideConflict.avgR,-1);
});
