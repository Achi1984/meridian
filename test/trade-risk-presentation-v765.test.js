import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../trade-risk-presentation-v765.js';

test('8.99% buffer advances target to 12% safe gate',()=>{
  const s=api.recoveryState(8.99);
  assert.equal(s.target,12);
  assert.equal(s.targetText,'SAFE ≥12,00%');
  assert.equal(s.gapText,'3,01 %-Pkt.');
  assert.equal(s.gate,'BLOCKED');
  assert.equal(api.commanderTarget(8.99),'SAFE ≥12%');
});

test('sub-8 buffer still targets recovery gate',()=>{
  const s=api.recoveryState(7.4);
  assert.equal(s.target,8);
  assert.equal(s.gapText,'0,60 %-Pkt.');
  assert.equal(api.commanderTarget(7.4),'RECOVERY ≥8%');
});

test('safe buffer reports surplus instead of missing amount',()=>{
  const s=api.recoveryState(13.25);
  assert.equal(s.gate,'OPEN');
  assert.equal(s.gapText,'+1,25 %-Pkt. ÜBER');
  assert.equal(api.commanderTarget(13.25),'PORTFOLIO GATE');
});

test('short fib levels below current are profit and above current are risk',()=>{
  assert.deepEqual(api.fibRole({side:'SHORT',level:75000,current:80000}),{role:'PROFIT',tone:'green'});
  assert.deepEqual(api.fibRole({side:'SHORT',level:85000,current:80000}),{role:'RISK',tone:'red'});
});

test('long fib semantics are mirrored',()=>{
  assert.deepEqual(api.fibRole({side:'LONG',level:85000,current:80000}),{role:'PROFIT',tone:'green'});
  assert.deepEqual(api.fibRole({side:'LONG',level:75000,current:80000}),{role:'RISK',tone:'red'});
});
