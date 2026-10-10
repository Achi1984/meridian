import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoutineMerge as classify } from '../scripts/routine-merge-policy.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
function input(){return {policyAdopted:true,
 packet:{workId:'WORK001',owner:'CHATGPT',approved:true,repository:'Achi1984/meridian',headSha:head,baseSha:base,allowedPaths:['app-view.js'],requiredChecks:['tests'],priorRequiredChecks:['postmerge']},
 candidate:{workId:'WORK001',owner:'CHATGPT',repository:'Achi1984/meridian',headSha:head,baseSha:base,liveHeadSha:head,liveBaseSha:base,changes:[{path:'app-view.js',previousPath:null}]},
 ci:{runId:123,headSha:head,baseSha:base,checks:[{name:'tests',status:'COMPLETED',conclusion:'SUCCESS',total:10,passed:10,failed:0}]},
 review:{commentId:321,headSha:head,baseSha:base,reviewer:'CLAUDE',verdict:'GREEN_LIGHT',independent:true,fullDiffReviewed:true,gaps:0,unresolvedBlockers:0},
 coordination:{unknownOutcome:false,conflictingWriter:false},priorRelease:{headSha:base,checks:[{name:'postmerge',status:'COMPLETED',conclusion:'SUCCESS'}]},
 classification:{agreedProductScope:true,architecture:false,direction:false,costs:false,permissions:false,policy:false,workflows:false,releaseCadence:false,productionActivation:false,researchStage:false,tradingStage:false,security:false,deployment:false}};}
test('eligible candidate remains immutable untrusted and unauthorized',()=>{
 const s=input(),before=structuredClone(s),r=classify(s);assert.equal(r.eligibleForStandingApproval,true);
 for(const k of ['authorized','authenticated','provenanceVerified','mergeAllowed','dispatchAllowed'])assert.equal(r[k],false);
 assert.deepEqual(s,before);assert.deepEqual(classify(s),r);assert.ok(Object.isFrozen(r));
});
test('policy adoption, packet approval and semantic reserved actions deny',()=>{
 for(const change of [s=>s.policyAdopted=false,s=>s.packet.approved=false,s=>s.classification.agreedProductScope=false,
 ...Object.keys(input().classification).filter(k=>k!=='agreedProductScope').map(k=>s=>s.classification[k]=true)]){
 const s=input();change(s);assert.equal(classify(s).eligibleForStandingApproval,false);}
});
test('packet exact scope and all head/base pins must match',()=>{
 for(const change of [s=>s.candidate.workId='OTHER',s=>s.candidate.owner='CODEX',s=>s.candidate.liveHeadSha='c'.repeat(40),s=>s.candidate.liveBaseSha='c'.repeat(40),s=>s.ci.baseSha='c'.repeat(40),s=>s.review.headSha='c'.repeat(40),s=>s.priorRelease.headSha='c'.repeat(40),s=>s.candidate.changes[0].path='other.js']){
 const s=input();change(s);assert.equal(classify(s).eligibleForStandingApproval,false);}
});
test('protected paths and rename sources cannot be laundered into scope',()=>{
 for(const file of ['.github/workflows/ci.yml','MERIDIAN_GO.md','MERIDIAN_LIVE_CHECKPOINT.json','scripts/innocent.mjs','test/routine-merge-policy.test.js','docs/autonomy/PLAN.md','app-auth.js','release.js','research/model.js','package.json','AGENTS.md','paper-strategy.js','sw.js','manifest.webmanifest','index.html','version.json']){
 const s=input();s.packet.allowedPaths.push(file);s.candidate.changes[0].previousPath=file;assert.equal(classify(s).reason,'PROTECTED_PATH',file);}
 const s=input();s.candidate.changes=[];assert.equal(classify(s).reason,'EMPTY_DIFF');
});
test('unknown outcome and concurrent writer require reconciliation',()=>{
 for(const key of ['unknownOutcome','conflictingWriter']){const s=input();s.coordination[key]=true;assert.equal(classify(s).reason,'RECONCILE_COORDINATION');}
});
test('prior pipeline checks fail stop even when candidate evidence is green',()=>{
 for(const conclusion of ['FAILURE','PENDING','CANCELLED','SKIPPED']){const s=input();s.priorRelease.checks[0].conclusion=conclusion;assert.equal(classify(s).reason,'PRIOR_RELEASE_NOT_GREEN');}
 const s=input();s.priorRelease.checks=[];assert.equal(classify(s).reason,'PRIOR_RELEASE_NOT_GREEN');
});
test('CI missing, incomplete, failed, zero-total and review gaps block',()=>{
 for(const change of [s=>s.ci.checks=[],s=>s.ci.checks[0].status='RUNNING',s=>s.ci.checks[0].conclusion='FAILURE',s=>{s.ci.checks[0].total=0;s.ci.checks[0].passed=0;},s=>s.review.independent=false,s=>s.review.fullDiffReviewed=false,s=>s.review.gaps=1,s=>s.review.unresolvedBlockers=1,s=>s.review.verdict='NEEDS_MORE_EVIDENCE']){
 const s=input();change(s);assert.equal(classify(s).eligibleForStandingApproval,false);}
});
test('strict malformed and hostile inputs reject before early return',()=>{
 const s=input();s.policyAdopted=false;s.ci.checks[0].total=11;assert.throws(()=>classify(s),/INVALID_TOTALS/);
 assert.throws(()=>classify({...input(),authorized:true}),/INVALID_SCHEMA/);
 const getter=input();Object.defineProperty(getter,'review',{enumerable:true,get(){throw Error('getter ran');}});assert.throws(()=>classify(getter),/INVALID_DESCRIPTOR/);
 assert.throws(()=>classify(new Proxy(input(),{ownKeys(){throw Error('trap ran');}})),/INVALID_OBJECT/);
 const traversal=input();traversal.candidate.changes[0].path='src/../secret';assert.throws(()=>classify(traversal),/INVALID_DIFF/);
 const duplicate=input();duplicate.ci.checks.push({...duplicate.ci.checks[0]});assert.throws(()=>classify(duplicate),/INVALID_CHECKS/);
});
