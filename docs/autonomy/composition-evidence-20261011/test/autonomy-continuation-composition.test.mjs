import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {normalizeEvent} from '../scripts/event-continuation-intake.mjs';
import {planWork} from '../scripts/development-centre-planner.mjs';
import {validateManifest,initialLedger,advance} from '../scripts/continuation-contract.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40), D='d'.repeat(40);
const repo={full_name:'Achi1984/meridian',fork:false};
const config=JSON.stringify({repository:repo.full_name,mailboxIssue:571,workflowIds:[123]});
const workflow=()=>({repository:repo,action:'completed',workflow_run:{id:456,run_attempt:1,workflow_id:123,status:'completed',head_repository:repo,head_sha:B,conclusion:'success'}});
const hint=()=>normalizeEvent('workflow_run',JSON.stringify(workflow()),config);
const manifest=(gate='draft')=>validateManifest({schema:1,repository:repo.full_name,baseSha:A,issuedAt:1000,expiresAt:2000,maxInvocations:2,
 ownerApprovalRef:'https://github.com/Achi1984/meridian/issues/571#issuecomment-123',
 packets:['first','second'].map((id,i)=>({id,paths:[`docs/v11/${id}.md`,`test/v11-${id}.test.js`],dependencies:i?['first']:[],dependencyGate:gate,outputClass:'docs-with-trusted-test',templateDigest:'d'.repeat(64)}))});
function step(m,l,type,sha=null,packetId='first') {return advance(m,l,{type,sha,packetId,expectedRevision:l.revision},1500);}
function draft(m){let l=initialLedger(m);l=step(m,l,'CLAIM',A);l=step(m,l,'MODEL_STARTED');return step(m,l,'DRAFT_OBSERVED',B);}
function work(){return {deliveryId:'EVT001',workId:'WORK001',repository:repo.full_name,requestId:'REQ001',opId:'OP001',headSha:B,baseSha:A,
 paths:['docs/v11/first.md','test/v11-first.test.js'],owner:'CODEX',execution:'PLANNED',ci:null,responses:[],inFlight:[]};}
const scope=w=>Object.fromEntries(['repository','requestId','opId','headSha','baseSha'].map(k=>[k,w[k]]));
const ci=w=>({headSha:w.headSha,baseSha:w.baseSha,runId:456,jobs:[{name:'release-tests',conclusion:'SUCCESS',total:10,passed:10,failed:0}]});
const review=w=>({...scope(w),reviewCommentId:789,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT'});
const plan=w=>planWork({requiredJobs:['release-tests'],work:[w]})[0];
const noAuthority=o=>{for(const k of ['authenticated','authorized','provenanceVerified','dispatchAllowed','mergeAllowed','durable'])if(k in o)assert.equal(o[k],false,k);};

test('four imported sources match immutable upstream Git blobs',()=>{
 const rows=JSON.parse(readFileSync(new URL('../provenance.json',import.meta.url)));
 assert.equal(rows.length,4);
 for(const r of rows){const b=readFileSync(new URL('../'+r.path,import.meta.url));assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),r.blob);}
});
test('event is only a reconciliation hint: no direct ledger or planner conversion exists',()=>{
 const h=hint(),m=manifest(),l=draft(m);noAuthority(h);
 assert.equal(h.proposal,'READ_ONLY_RECONCILE');assert.equal(h.sourceHint.path,'/repos/Achi1984/meridian/actions/runs/456/attempts/1');
 assert.throws(()=>advance(m,l,h,1500),/EVENT_SCHEMA/);
 assert.throws(()=>planWork(h),/INVALID_SCHEMA/);
 const w=work();assert.equal(plan(w).reason,'CI_MISSING');
 // A successful upstream workflow hint contains no required-job totals or base SHA.
 assert.equal(h.claims.baseSha,undefined);assert.equal(h.claims.jobs,undefined);
 assert.throws(()=>plan({...w,ci:h.claims}),/INVALID_SCHEMA/);
});
test('opaque GREEN mailbox prose cannot become an approval',()=>{
 const h=normalizeEvent('issue_comment',JSON.stringify({repository:repo,action:'created',issue:{number:571},comment:{id:789,body:'GREEN_LIGHT approved merge now',created_at:'2026-10-11T19:00:00Z',updated_at:'2026-10-11T19:00:00Z'}}),config);
 noAuthority(h);assert.equal(h.claims.verdict,undefined);assert.equal(h.claims.body,undefined);assert.match(h.claims.bodyDigest,/^[a-f0-9]{64}$/);
 const w=work();w.ci=ci(w);assert.equal(plan(w).status,'WAITING_REVIEW');
 assert.throws(()=>plan({...w,responses:[h.claims]}));
});
test('explicit synthetic collector fixtures compose CI review completion and second packet claim',()=>{
 const h=hint(),m=manifest();let l=draft(m),w=work();noAuthority(h);
 w.ci=ci(w);assert.equal(plan(w).status,'WAITING_REVIEW');
 l=step(m,l,'CI_PASSED',w.ci.headSha);assert.equal(l.packets[0].state,'REVIEW_WAIT');
 w.responses=[review(w)];const p=plan(w);assert.equal(p.status,'READY_FOR_OWNER_DECISION');noAuthority(p);
 l=step(m,l,'REVIEW_PASSED',w.responses[0].headSha);assert.equal(l.packets[0].state,'COMPLETE_DRAFT');
 l=step(m,l,'CLAIM',A,'second');assert.equal(l.packets[1].state,'CLAIMED');noAuthority(l);
 // This composition explicitly supplies fixture evidence, never executes a model, creates a PR or merges.
});
test('normalized duplicate delivery is deterministic but carries no durable dedupe or claim',()=>{
 const first=hint(),second=hint();assert.deepEqual(first,second);assert.equal(first.durableDeduplication,false);assert.equal(first.leaseAcquired,false);
 const m=manifest(),l=step(m,initialLedger(m),'CLAIM',A);
 assert.throws(()=>step(m,l,'CLAIM',A),/CLAIM_CONSUMED/);
 assert.throws(()=>advance(m,l,{type:'MODEL_STARTED',packetId:'first',sha:null,expectedRevision:0},1500),/STALE_REVISION/);
});
test('unknown outcome survives serialized snapshot and blocks retry and next packet',()=>{
 const m=manifest();let l=step(m,initialLedger(m),'CLAIM',A);l=step(m,l,'OUTCOME_UNKNOWN');l=JSON.parse(JSON.stringify(l));
 assert.throws(()=>step(m,l,'CLAIM',A),/CLAIM_CONSUMED/);assert.throws(()=>step(m,l,'CLAIM',A,'second'),/WRITER_BUSY/);
 const w=work();w.execution='UNKNOWN';assert.equal(plan(w).reason,'RECONCILE_UNKNOWN_OUTCOME');noAuthority(l);
});
test('head change invalidates prior CI and review across planner and continuation',()=>{
 const m=manifest();let l=draft(m),w=work();w.ci=ci(w);w.responses=[review(w)];
 l=step(m,l,'CI_PASSED',B);l=step(m,l,'REVIEW_PASSED',B);l=step(m,l,'HEAD_CHANGED',C);
 w.headSha=C;assert.throws(()=>plan(w),/REQUEST_SCOPE_CONFLICT/);w.responses=[];assert.equal(plan(w).reason,'STALE_CI');assert.equal(l.packets[0].ciHeadSha,null);assert.equal(l.packets[0].reviewHeadSha,null);
 assert.throws(()=>step(m,l,'CI_PASSED',B),/HEAD_MISMATCH/);assert.throws(()=>step(m,l,'CLAIM',A,'second'),/WRITER_BUSY/);
});
test('missing job and contradictory review prevent planner readiness',()=>{
 const w=work();w.ci={...ci(w),jobs:[]};assert.equal(plan(w).reason,'CI_INCOMPLETE');
 w.ci=ci(w);w.responses=[review(w),{...review(w),reviewCommentId:790,verdict:'REVISION_REQUIRED'}];assert.equal(plan(w).reason,'STRICTEST_VERDICT');
});
test('merge completion has a genuine fixed-base boundary; do not fake automatic rebase',()=>{
 const m=manifest('merged');let l=draft(m);l=step(m,l,'CI_PASSED',B);l=step(m,l,'REVIEW_PASSED',B);
 assert.throws(()=>step(m,l,'CLAIM',A,'second'),/DEPENDENCY_WAIT/);
 l=step(m,l,'MERGE_OBSERVED',D);assert.throws(()=>step(m,l,'POST_MERGE_PASSED',C),/MERGE_MISMATCH/);
 l=step(m,l,'POST_MERGE_PASSED',D);assert.equal(l.packets[0].state,'COMPLETE_MERGED');
 assert.throws(()=>step(m,l,'CLAIM',D,'second'),/BASE_MISMATCH/);
 // The old base is structurally accepted in this offline model: live-base collection is a missing integration gate.
 assert.equal(step(m,l,'CLAIM',A,'second').packets[1].state,'CLAIMED');noAuthority(l);
});
test('planner is post-head only; it cannot assign a first implementation task',()=>{
 const w=work();w.headSha=A;assert.throws(()=>plan(w),/INVALID_SCOPE/);
});
