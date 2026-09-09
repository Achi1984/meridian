import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePaperLearning,PAPER_LEARNING_POLICY} from '../paper-learning-policy.js';

const trade=realized=>({status:'CLOSED',realized});
const state=(rows,start=0)=>({trades:rows,executionPolicy:{version:'R31-COST-BUDGET-V1',startingClosedCount:start}});

test('waits for the prospective cost phase without reclassifying legacy trades',()=>{
  const out=evaluatePaperLearning({trades:[trade(-32),trade(-32)]});
  assert.equal(out.status,'WAITING_FOR_PHASE');
  assert.equal(out.performance.closedTrades,0);
});

test('builds a sample from only post-policy trades',()=>{
  const out=evaluatePaperLearning(state([trade(-100),trade(-100),trade(20),trade(-10)],2));
  assert.equal(out.status,'BUILDING');
  assert.equal(out.performance.closedTrades,2);
  assert.equal(out.performance.pnl,10);
  assert.equal(out.remainingTrades,18);
});

test('retires a clearly negative phase at the evidence checkpoint',()=>{
  const rows=Array.from({length:30},(_,i)=>trade(i%3===0?10:-10));
  const out=evaluatePaperLearning(state(rows));
  assert.equal(out.status,'RETIRE');
  assert.equal(out.decision,'RETIRE_NO_EDGE');
  assert.ok(out.performance.profitFactor<PAPER_LEARNING_POLICY.weakProfitFactor);
});

test('keeps a positive phase unchanged',()=>{
  const rows=Array.from({length:30},(_,i)=>trade(i%2===0?15:-10));
  const out=evaluatePaperLearning(state(rows));
  assert.equal(out.status,'PROMISING');
  assert.equal(out.decision,'KEEP_RUNNING');
});

test('extends a borderline phase instead of parameter fishing',()=>{
  const rows=Array.from({length:30},(_,i)=>trade(i%2===0?10.2:-10));
  const out=evaluatePaperLearning(state(rows));
  assert.equal(out.status,'EXTEND');
  assert.equal(out.targetClosedTrades,50);
});
