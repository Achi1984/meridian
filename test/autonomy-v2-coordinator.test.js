import test from 'node:test';
import assert from 'node:assert/strict';
import {planClaim,planReview,planResume} from '../scripts/autonomy-v2-coordinator.mjs';
import {STATES} from '../scripts/autonomy-v2-state.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const task=()=>({state:STATES.QUEUED,revision:0,attempts:0,head,base,writer:null,budget:{limit:2,used:0},opIds:[]});
const claim=()=>({now:100,expectedRevision:0,expectedHead:head,expectedBase:base,opId:'claim-1',writer:'lead'});
test('coordinator claim respects quota and state CAS',()=>{
 assert.equal(planClaim(task(),claim()).next.state,STATES.CLAIMED);
 assert.equal(planClaim({...task(),budget:{limit:1,used:1}},claim()).reason,'BUDGET_EXHAUSTED');
});
test('coordinator refuses expired lease without reconciliation',()=>{
 assert.equal(planClaim({...task(),lease:{owner:'lead',expiresAt:99}},claim()).reason,'RECONCILE_LEASE_FIRST');
});
test('review planner refuses caller assertion without verified snapshot',()=>{
 const t={...task(),state:STATES.REVIEW_REQUESTED,writer:'lead',ciEvidence:{head,base,conclusion:'success',testCount:1}};
 const ev={...claim(),review:{head,base,reviewer:'CLAUDE',commentId:5,verdict:'GREEN_LIGHT'}};
 assert.equal(planReview(t,ev,null).ok,false);
});
test('review planner binds snapshot to exact comment',()=>{
 const t={...task(),state:STATES.REVIEW_REQUESTED,writer:'lead',ciEvidence:{head,base}};
 const ev={...claim(),review:{head,base,reviewer:'CLAUDE',commentId:5,verdict:'GREEN_LIGHT'}};
 const snap={source:'synthetic-unverified',author:'claude[bot]',commentId:6,head,base,liveHead:head,verdict:'GREEN_LIGHT',ci:{head,base,conclusion:'success',testCount:1}};
 assert.equal(planReview(t,ev,snap).reason,'EVIDENCE_MISMATCH');
 assert.equal(planReview(t,ev,{...snap,commentId:5}).next.state,STATES.REVIEW_GREEN);
});
test('coordinator resume is advisory and blocks advanced head',()=>{
 const t={...task(),taskId:'t1'};
 assert.equal(planResume(t,{...t,head:'c'.repeat(40)},{opId:'new',writer:'lead',expectedRevision:0,expectedHead:head,expectedBase:base}).action,'BLOCK');
});
