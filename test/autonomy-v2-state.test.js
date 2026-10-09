import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,STATES} from '../scripts/autonomy-v2-state.mjs';
const SHA='a'.repeat(40),BASE='b'.repeat(40);
const task=(state=STATES.QUEUED,overrides={})=>({state,revision:0,attempts:0,head:SHA,base:BASE,lastOpId:null,budget:{limit:2,used:0},writer:state===STATES.QUEUED?null:'lead',ciEvidence:state===STATES.REVIEW_REQUESTED?{head:SHA,base:BASE,conclusion:'success',testCount:1}:null,...overrides});
const ev=(to,overrides={})=>({to,expectedRevision:0,expectedHead:SHA,expectedBase:BASE,opId:'op-1',now:100,verifiedSynthetic:true,writer:'lead',...overrides});
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
 assert.equal(transition(task(STATES.CI_CHECK,{writer:'lead'}),ev(STATES.REVIEW_REQUESTED,{ci:{runId:123,head:SHA,base:BASE,conclusion:'success',testCount:10}})).state,STATES.REVIEW_REQUESTED);
});
test('review is bound to exact head and base',()=>{
 const t=task(STATES.REVIEW_REQUESTED,{writer:'lead'});
 assert.throws(()=>transition(t,ev(STATES.REVIEW_GREEN,{review:{head:BASE,base:BASE,verdict:'GREEN_LIGHT'}})),/STALE_REVIEW/);
 assert.equal(transition(t,ev(STATES.REVIEW_GREEN,{review:{head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'CLAUDE',commentId:123}})).state,STATES.REVIEW_GREEN);
});
test('repair attempts are bounded to three',()=>{
 for(let n=0;n<3;n++)assert.equal(transition(task(STATES.CI_CHECK,{attempts:n,writer:'lead'}),ev(STATES.REPAIR)).attempts,n+1);
 assert.equal(transition(task(STATES.CI_CHECK,{attempts:3,writer:'lead'}),ev(STATES.REPAIR)).state,STATES.BLOCKED);
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
 for(const ci of [{runId:1,head:BASE,base:BASE,conclusion:'success',testCount:10},{runId:1,head:SHA,base:BASE,conclusion:'failure',testCount:10},{runId:1,head:SHA,base:BASE,conclusion:'success',testCount:0},{runId:1,head:SHA,base:SHA,conclusion:'success',testCount:10}])
 assert.throws(()=>transition(t,ev(STATES.REVIEW_REQUESTED,{ci})),/CI_NOT_GREEN/);
});
test('supervisor can block with reason but cannot impersonate writer',()=>{
 const t=task(STATES.CI_CHECK,{writer:'lead'});
 assert.throws(()=>transition(t,ev(STATES.BLOCKED,{writer:'supervisor'})),/BLOCK_REASON_REQUIRED/);
 assert.equal(transition(t,ev(STATES.BLOCKED,{writer:'supervisor',reason:'lease expired'})).state,STATES.BLOCKED);
 assert.throws(()=>transition(t,ev(STATES.REPAIR,{writer:'supervisor'})),/WRITER_CONFLICT/);
});

test('repair cannot return to CI without a new head',()=>{
 const t=task(STATES.REPAIR,{writer:'lead'});
 assert.throws(()=>transition(t,ev(STATES.CI_CHECK)),/HEAD_ADVANCE_REQUIRED/);
 assert.throws(()=>transition(t,ev(STATES.CI_CHECK,{newHead:SHA})),/INVALID_HEAD_ADVANCE/);
});
test('old operation ID cannot be replayed after intervening operations',()=>{
 const first=transition(task(),ev(STATES.CLAIMED));
 const second=transition(first,ev(STATES.IMPLEMENTING,{expectedRevision:1,opId:'op-2'}));
 assert.deepEqual(second.opIds,['op-1','op-2']);
 assert.throws(()=>transition(second,ev(STATES.CI_CHECK,{expectedRevision:2,opId:'op-1'})),/DUPLICATE_OP_ID/);
});
test('malformed operation journal is rejected',()=>{
 assert.throws(()=>transition(task(STATES.QUEUED,{opIds:'invalid'}),ev(STATES.CLAIMED)),/INVALID_JOURNAL/);
});

test('reviewer identity and comment id are mandatory',()=>{
 const t=task(STATES.REVIEW_REQUESTED,{writer:'lead'});
 for(const review of [{head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'OTHER',commentId:1},{head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'CLAUDE',commentId:0}])
 assert.throws(()=>transition(t,ev(STATES.REVIEW_GREEN,{review})),/STALE_REVIEW/);
});

test('base mismatch blocks stale evidence',()=>{
 assert.throws(()=>transition(task(),ev(STATES.CLAIMED,{expectedBase:SHA})),/STALE_BASE/);
});

test('missing expected base fails closed',()=>{assert.throws(()=>transition(task(),ev(STATES.CLAIMED,{expectedBase:undefined})),/STALE_BASE/);});
test('unclaimed writer cannot operate active task',()=>{assert.throws(()=>transition(task(STATES.CI_CHECK,{writer:null}),ev(STATES.REPAIR)),/MISSING_CLAIMED_WRITER/);});
test('review green requires matching prior CI evidence',()=>{assert.throws(()=>transition(task(STATES.REVIEW_REQUESTED,{ciEvidence:null}),ev(STATES.REVIEW_GREEN,{review:{head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'CLAUDE',commentId:1}})),/STALE_REVIEW/);});

test('review requires persisted matching CI evidence',()=>{
 const review={head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'CLAUDE',commentId:7};
 const valid=task(STATES.REVIEW_REQUESTED,{ciEvidence:{head:SHA,base:BASE,conclusion:'success',testCount:1}});
 assert.equal(transition(valid,ev(STATES.REVIEW_GREEN,{review})).state,STATES.REVIEW_GREEN);
 for(const ciEvidence of [null,{head:BASE,base:BASE},{head:SHA,base:SHA}])
  assert.throws(()=>transition(task(STATES.REVIEW_REQUESTED,{ciEvidence}),ev(STATES.REVIEW_GREEN,{review})),/STALE_REVIEW/);
});

test('review green rejects forged CI conclusion or zero tests',()=>{
 const review={head:SHA,base:BASE,verdict:'GREEN_LIGHT',reviewer:'CLAUDE',commentId:9};
 for(const ciEvidence of [{head:SHA,base:BASE,conclusion:'failure',testCount:1},{head:SHA,base:BASE,conclusion:'success',testCount:0}])
  assert.throws(()=>transition(task(STATES.REVIEW_REQUESTED,{ciEvidence}),ev(STATES.REVIEW_GREEN,{review})),/STALE_REVIEW/);
});
