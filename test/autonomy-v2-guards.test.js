import test from 'node:test';
import assert from 'node:assert/strict';
import {assessClaim,verifyReviewSnapshot} from '../scripts/autonomy-v2-guards.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const task=()=>({state:'QUEUED',revision:1,head,base,budget:{limit:2,used:0}});
const proposal=()=>({now:100,writer:'lead',expectedRevision:1,expectedHead:head,expectedBase:base});
test('synthetic claim only eligible with budget and CAS',()=>{assert.equal(assessClaim(task(),proposal()).allow,true);});
test('exhausted quota blocks claim',()=>{assert.equal(assessClaim({...task(),budget:{limit:2,used:2}},proposal()).reason,'BUDGET_EXHAUSTED');});
test('lease expiry requires reconciliation before claim',()=>{assert.equal(assessClaim({...task(),lease:{owner:'lead',expiresAt:99}},proposal()).reason,'RECONCILE_LEASE_FIRST');});
test('another writer lease blocks claim',()=>{assert.equal(assessClaim({...task(),lease:{owner:'other',expiresAt:200}},proposal()).allow,false);});
test('stale base and revision block claim',()=>{assert.equal(assessClaim(task(),{...proposal(),expectedBase:head}).reason,'STALE_CAS');assert.equal(assessClaim(task(),{...proposal(),expectedRevision:0}).allow,false);});
const review=()=>({source:'synthetic-unverified',author:'claude[bot]',commentId:5,head,base,liveHead:head,verdict:'GREEN_LIGHT',ci:{head,base,conclusion:'success',testCount:2}});
test('synthetic verified review evidence passes',()=>{assert.equal(verifyReviewSnapshot(review(),{head,base}).valid,true);});
test('spoofed author, stale head and skipped CI reject',()=>{
 assert.equal(verifyReviewSnapshot({...review(),author:'attacker'},{head,base}).valid,false);
 assert.equal(verifyReviewSnapshot({...review(),liveHead:base},{head,base}).valid,false);
 assert.equal(verifyReviewSnapshot({...review(),ci:{...review().ci,testCount:0}},{head,base}).valid,false);
});
