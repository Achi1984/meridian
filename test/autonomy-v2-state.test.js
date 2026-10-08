import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,STATES} from '../scripts/autonomy-v2-state.mjs';
const SHA='a'.repeat(40),BASE='b'.repeat(40);
const task=(state=STATES.QUEUED,overrides={})=>({state,revision:0,attempts:0,head:SHA,base:BASE,lastOpId:null,writer:null,...overrides});
const ev=(to,overrides={})=>({to,expectedRevision:0,expectedHead:SHA,opId:'op-1',writer:'lead',...overrides});
test('claim and implement require a consistent single writer',()=>{
 const claimed=transition(task(),ev(STATES.CLAIMED));
 assert.equal(claimed.writer,'lead');
 assert.equal(transition(claimed,ev(STATES.IMPLEMENTING,{expectedRevision:1,opId:'op-2'})).state,STATES.IMPLEMENTING);
 assert.throws(()=>transition(claimed,ev(STATES.IMPLEMENTING,{expectedRevision:1,opId:'op-2',writer:'other'})),/WRITER_CONFLICT/);
});
test('stale revision and head are rejected',()=>{
 assert.throws(()=>transition(task(),ev(STATES.CLAIMED,{expectedRevision:1})),/STALE_CAS/);
 assert.throws(()=>transition(task(),ev(STATES.CLAIMED,{expectedHead:BASE})),/STALE_CAS/);
});
test('duplicate operation id is rejected',()=>{
 assert.throws(()=>transition(task(STATES.CLAIMED,{lastOpId:'op-1',writer:'lead'}),ev(STATES.IMPLEMENTING)),/DUPLICATE_OP_ID/);
});
test('invalid transition and missing operation id fail closed',()=>{
 assert.throws(()=>transition(task(),ev(STATES.REVIEW_GREEN)),/INVALID_TRANSITION/);
 assert.throws(()=>transition(task(),ev(STATES.CLAIMED,{opId:''})),/MISSING_OP_ID/);
});
test('CI exact head evidence required before review',()=>{
 assert.throws(()=>transition(task(STATES.CI_CHECK,{writer:'lead'}),ev(STATES.REVIEW_REQUESTED)),/CI_NOT_GREEN/);
 assert.equal(transition(task(STATES.CI_CHECK,{writer:'lead'}),ev(STATES.REVIEW_REQUESTED,{ci:{runId:123,head:SHA,conclusion:'success',testCount:10}})).state,STATES.REVIEW_REQUESTED);
});
test('review is bound to exact head and base',()=>{
 const t=task(STATES.REVIEW_REQUESTED,{writer:'lead'});
 assert.throws(()=>transition(t,ev(STATES.REVIEW_GREEN,{review:{head:BASE,base:BASE,verdict:'GREEN_LIGHT'}})),/STALE_REVIEW/);
 assert.equal(transition(t,ev(STATES.REVIEW_GREEN,{review:{head:SHA,base:BASE,verdict:'GREEN_LIGHT'}})).state,STATES.REVIEW_GREEN);
});
test('repair attempts are bounded to three',()=>{
 for(let n=0;n<3;n++)assert.equal(transition(task(STATES.CI_CHECK,{attempts:n,writer:'lead'}),ev(STATES.REPAIR)).attempts,n+1);
 assert.throws(()=>transition(task(STATES.CI_CHECK,{attempts:3,writer:'lead'}),ev(STATES.REPAIR)),/REPAIR_BUDGET_EXHAUSTED/);
});
test('human gate is terminal, not auto-approved',()=>{
 assert.throws(()=>transition(task(STATES.HUMAN_GATE,{writer:'lead'}),ev(STATES.CLAIMED)),/INVALID_TRANSITION/);
 assert.equal(transition(task(STATES.REVIEW_GREEN,{writer:'lead'}),ev(STATES.HUMAN_GATE)).state,STATES.HUMAN_GATE);
});
test('blocked state cannot restart automatically',()=>{
 assert.throws(()=>transition(task(STATES.BLOCKED,{writer:'lead'}),ev(STATES.CLAIMED)),/INVALID_TRANSITION/);
});
test('input task is not mutated',()=>{
 const t=task();transition(t,ev(STATES.CLAIMED));assert.equal(t.state,STATES.QUEUED);assert.equal(t.revision,0);
});

test('repair updates head with CAS and clears stale evidence',()=>{
 const next='c'.repeat(40),t=task(STATES.REPAIR,{writer:'lead',ciEvidence:{runId:1},reviewEvidence:{verdict:'GREEN_LIGHT'}});
 const n=transition(t,ev(STATES.CI_CHECK,{newHead:next}));
 assert.equal(n.head,next);assert.equal(n.ciEvidence,null);assert.equal(n.reviewEvidence,null);
 assert.throws(()=>transition(t,ev(STATES.CI_CHECK,{newHead:'bad'})),/INVALID_HEAD_ADVANCE/);
});
test('CI evidence must match exact head and nonzero test count',()=>{
 const t=task(STATES.CI_CHECK,{writer:'lead'});
 for(const ci of [{runId:1,head:BASE,conclusion:'success',testCount:10},{runId:1,head:SHA,conclusion:'failure',testCount:10},{runId:1,head:SHA,conclusion:'success',testCount:0}])
 assert.throws(()=>transition(t,ev(STATES.REVIEW_REQUESTED,{ci})),/CI_NOT_GREEN/);
});
test('supervisor can block with reason but cannot impersonate writer',()=>{
 const t=task(STATES.CI_CHECK,{writer:'lead'});
 assert.throws(()=>transition(t,ev(STATES.BLOCKED,{writer:'supervisor'})),/BLOCK_REASON_REQUIRED/);
 assert.equal(transition(t,ev(STATES.BLOCKED,{writer:'supervisor',reason:'lease expired'})).state,STATES.BLOCKED);
 assert.throws(()=>transition(t,ev(STATES.REPAIR,{writer:'supervisor'})),/WRITER_CONFLICT/);
});
