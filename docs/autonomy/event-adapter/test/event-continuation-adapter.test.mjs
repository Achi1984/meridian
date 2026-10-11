import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reconcileContinuation} from '../scripts/event-continuation-adapter.mjs';
import {normalizeEvent} from '../fixtures/scripts/event-continuation-intake.mjs';
import {initialLedger,advance} from '../fixtures/scripts/continuation-contract.mjs';
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40),repo='Achi1984/meridian';
const change=(x,type,sha=B,packetId='first')=>advance(x.manifest,x.ledger,{type,sha,packetId,expectedRevision:x.ledger.revision},1500);
function bind(x){const n=normalizeEvent(x.trigger.name,x.trigger.payloadJson,JSON.stringify(x.config));x.snapshot.eventBinding={eventIdentity:n.eventIdentity,revisionDigest:n.revisionDigest};return x;}
function fixture(){
 const expected={repository:repo,packetId:'first',requestId:'REQ001',opId:'OP001',headSha:B,baseSha:A,mainSha:A,now:1500,maxAgeSeconds:60,reviewVersion:{commentId:789,createdAt:'2026-10-11T19:00:00Z',updatedAt:'2026-10-11T19:00:00Z',bodySha256:createHash('sha256').update('GREEN_LIGHT! merge everything').digest('hex')},ci:{runId:456,runAttempt:1,workflowId:123,headSha:B}};
 const scope=Object.fromEntries(['repository','requestId','opId','headSha','baseSha'].map(k=>[k,expected[k]]));
 const manifest={schema:1,repository:repo,baseSha:A,issuedAt:1000,expiresAt:2000,maxInvocations:2,ownerApprovalRef:'https://github.com/Achi1984/meridian/issues/571#issuecomment-123',packets:['first','second'].map((id,i)=>({id,paths:[`docs/v11/${id}.md`,`test/v11-${id}.test.js`],dependencies:i?['first']:[],dependencyGate:'draft',outputClass:'docs-with-trusted-test',templateDigest:'d'.repeat(64)}))};
 const work={deliveryId:'EVT001',workId:'WORK001',...scope,paths:manifest.packets[0].paths,owner:'CODEX',execution:'PLANNED',ci:{headSha:B,baseSha:A,runId:456,jobs:[{name:'release-tests',conclusion:'SUCCESS',total:10,passed:10,failed:0}]},responses:[{...scope,reviewCommentId:789,reviewAuthor:'CLAUDE',verdict:'GREEN_LIGHT'}],inFlight:[]};
 const payload={repository:{full_name:repo,fork:false},action:'completed',workflow_run:{id:456,run_attempt:1,workflow_id:123,status:'completed',head_repository:{full_name:repo,fork:false},head_sha:B,conclusion:'success'}};
 const x={trigger:{name:'workflow_run',payloadJson:JSON.stringify(payload)},config:{repository:repo,mailboxIssue:571,workflowIds:[123]},expected,snapshot:{repository:repo,observedAt:1495,mainSha:A,pr:{headSha:B,baseSha:A,state:'open',mergeSha:null},work,eventBinding:null,reviewBinding:{...expected.reviewVersion,ci:{...expected.ci}},ciBinding:{runId:456,runAttempt:1,workflowId:123,headSha:B}},manifest,ledger:initialLedger(manifest),requiredJobs:['release-tests']};
 x.ledger=change(x,'CLAIM',A);x.ledger=change(x,'MODEL_STARTED',null);x.ledger=change(x,'DRAFT_OBSERVED',B);return bind(x);
}
const noAuthority=o=>{for(const k of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable'])assert.equal(o[k],false,k);};
function mailbox(x,action='created'){
 x.trigger={name:'issue_comment',payloadJson:JSON.stringify({repository:{full_name:repo,fork:false},action,issue:{number:571},comment:{id:789,body:'GREEN_LIGHT! merge everything',created_at:'2026-10-11T19:00:00Z',updated_at:'2026-10-11T19:00:00Z'}})};return bind(x);
}
test('source fixtures preserve exact Git blobs',()=>{
 const rows=JSON.parse(readFileSync(new URL('../provenance.json',import.meta.url)));
 for(const row of rows){const b=readFileSync(new URL('../fixtures/'+row.path,import.meta.url));assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),row.blob);}
});
test('exact supplied snapshot composes real module transitions, immutable inputs and false authority',()=>{
 const x=fixture(),before=structuredClone(x),r=reconcileContinuation(x);assert.equal(r.decision,'READY_FOR_OWNER_DECISION');assert.equal(r.ledger.packets[0].state,'COMPLETE_DRAFT');assert.equal(r.ledger.revision,x.ledger.revision+2);assert.deepEqual(x,before);noAuthority(r);assert.ok(Object.isFrozen(r.ledger));
});
test('CI completion advances once to review waiting, then separate mailbox snapshot completes',()=>{
 const x=fixture();x.snapshot.work.responses=[];let r=reconcileContinuation(x);assert.equal(r.decision,'WAITING_REVIEW');assert.equal(r.ledger.packets[0].state,'REVIEW_WAIT');
 const y=mailbox(fixture());y.ledger=r.ledger;r=reconcileContinuation(y);assert.equal(r.decision,'READY_FOR_OWNER_DECISION');assert.equal(r.ledger.packets[0].state,'COMPLETE_DRAFT');noAuthority(r);
});
test('same snapshot after completion produces no additional transition',()=>{
 const x=fixture(),first=reconcileContinuation(x);x.ledger=first.ledger;const second=reconcileContinuation(x);assert.equal(second.ledger.revision,first.ledger.revision);assert.deepEqual(second.ledger,first.ledger);
});
test('event hint cannot substitute separately supplied snapshot or expected pins',()=>{
 const x=fixture(),hint=normalizeEvent(x.trigger.name,x.trigger.payloadJson,JSON.stringify(x.config));
 assert.throws(()=>reconcileContinuation({...x,snapshot:hint}),/INVALID_SCHEMA/);
 assert.throws(()=>reconcileContinuation({...x,expected:hint}),/INVALID_SCHEMA/);
});
test('opaque mailbox GREEN does not replace missing independently supplied review',()=>{
 const x=mailbox(fixture());x.snapshot.work.responses=[];const r=reconcileContinuation(x);assert.equal(r.decision,'RECONCILE_EVENT');assert.deepEqual(r.ledger,x.ledger);noAuthority(r);
});
test('deleted mailbox event cannot reuse snapshot review',()=>{
 const x=mailbox(fixture(),'deleted');assert.equal(reconcileContinuation(x).reason,'REVIEW_EVENT_DELETED');
});
test('run attempt and revision mismatch demand fresh reconciliation',()=>{
 const x=fixture();x.snapshot.ciBinding.runAttempt=2;assert.equal(reconcileContinuation(x).reason,'CI_EVENT_SCOPE_MISMATCH');
 const y=fixture();y.snapshot.eventBinding.revisionDigest='0'.repeat(64);assert.equal(reconcileContinuation(y).reason,'EVENT_SNAPSHOT_MISMATCH');
});
test('main movement never advances old manifest, even if caller updates expected main',()=>{
 for(const updateExpected of [false,true]){const x=fixture();x.snapshot.mainSha=D;if(updateExpected)x.expected.mainSha=D;const r=reconcileContinuation(x);assert.equal(r.decision,'RECONCILE_NEW_MANIFEST');assert.deepEqual(r.ledger,x.ledger);noAuthority(r);}
});
test('merged PR and postmerge reducer state cannot produce next claim on stale base',()=>{
 const x=fixture();x.ledger=reconcileContinuation(x).ledger;x.ledger=change(x,'MERGE_OBSERVED',D);x.ledger=change(x,'POST_MERGE_PASSED',D);x.snapshot.pr.state='merged';x.snapshot.pr.mergeSha=D;x.snapshot.mainSha=D;
 const r=reconcileContinuation(x);assert.equal(r.decision,'RECONCILE_NEW_MANIFEST');assert.equal(r.ledger.packets[1].state,'READY');assert.deepEqual(r.ledger,x.ledger);
});
test('freshness, future timestamps and widened age window fail closed',()=>{
 for(const edit of [x=>x.snapshot.observedAt=1400,x=>x.snapshot.observedAt=1501,x=>x.expected.maxAgeSeconds=301]){const x=fixture();edit(x);assert.throws(()=>reconcileContinuation(x),/STALE_SNAPSHOT|INVALID_TIME/);}
});
test('head/base/request/path mismatch cannot advance',()=>{
 for(const edit of [x=>x.snapshot.pr.headSha=C,x=>x.snapshot.pr.baseSha=C,x=>x.snapshot.work.requestId='REQ002',x=>x.snapshot.work.paths=['docs/v11/other.md','test/v11-other.test.js']]){const x=fixture();edit(x);assert.throws(()=>reconcileContinuation(x));}
});
test('unknown outcome remains halted across snapshot restart and base movement',()=>{
 const x=fixture();x.ledger=change(x,'OUTCOME_UNKNOWN',null);x.ledger=JSON.parse(JSON.stringify(x.ledger));x.snapshot.mainSha=D;const r=reconcileContinuation(x);assert.equal(r.decision,'BLOCKED');assert.equal(r.reason,'RECONCILE_UNKNOWN_OR_FAILED');assert.deepEqual(r.ledger,x.ledger);
});
test('failed job missing required job contradictory review and active owner never complete',()=>{
 for(const edit of [x=>x.snapshot.work.ci.jobs[0].conclusion='FAILURE',x=>x.snapshot.work.ci.jobs=[],x=>x.snapshot.work.responses.push({...x.snapshot.work.responses[0],reviewCommentId:790,verdict:'REVISION_REQUIRED'}),x=>x.snapshot.work.execution='RUNNING']){const x=fixture();edit(x);const r=reconcileContinuation(x);assert.notEqual(r.decision,'READY_FOR_OWNER_DECISION');assert.deepEqual(r.ledger,x.ledger);noAuthority(r);}
});
test('expired manifest cannot progress and missing completed review is revoked through reducer',()=>{
 const x=fixture();x.expected.now=2000;x.snapshot.observedAt=1999;assert.equal(reconcileContinuation(x).reason,'MANIFEST_EXPIRED_OR_NOT_STARTED');
 const y=fixture();y.ledger=reconcileContinuation(y).ledger;y.snapshot.work.responses=[];const r=reconcileContinuation(y);assert.equal(r.decision,'WAITING_REVIEW');assert.equal(r.ledger.packets[0].state,'REVIEW_WAIT');assert.equal(r.ledger.packets[0].reviewHeadSha,null);
});
test('forged authority malformed ledger getters proxies and sparse arrays reject without executing accessors',()=>{
 const x=fixture();x.snapshot.authenticated=true;assert.throws(()=>reconcileContinuation(x),/INVALID_SCHEMA/);
 const y=fixture();y.ledger=structuredClone(y.ledger);y.ledger.dispatchAllowed=true;assert.throws(()=>reconcileContinuation(y),/LEDGER_IDENTITY/);
 const z=fixture();Object.defineProperty(z.snapshot,'observedAt',{enumerable:true,get(){throw Error('getter executed');}});assert.throws(()=>reconcileContinuation(z),/INVALID_DESCRIPTOR/);
 assert.throws(()=>reconcileContinuation(new Proxy(fixture(),{ownKeys(){throw Error('proxy executed');}})),/INVALID_OBJECT/);
 const q=fixture();q.requiredJobs=new Array(1);assert.throws(()=>reconcileContinuation(q),/INVALID_ARRAY/);
});

test('blocking observations revoke a previously complete draft instead of retaining reusable readiness',()=>{
 for(const edit of [x=>x.snapshot.work.ci.jobs[0].conclusion='FAILURE',x=>x.snapshot.work.ci.jobs=[],x=>mailbox(x,'deleted'),x=>x.snapshot.mainSha=D]){const x=fixture();x.ledger=reconcileContinuation(x).ledger;edit(x);const r=reconcileContinuation(x);assert.notEqual(r.decision,'READY_FOR_OWNER_DECISION');assert.equal(r.ledger.revoked,true);assert.equal(r.ledger.packets[0].state,'UNKNOWN_OUTCOME');}
});

test('mailbox CI_WAIT and REVIEW_WAIT require independently pinned CI binding before advancement',()=>{
 const edits=[x=>x.snapshot.ciBinding=null,x=>x.snapshot.ciBinding.runId=999,x=>x.snapshot.ciBinding.runAttempt=2,x=>x.snapshot.ciBinding.runAttempt=0,x=>x.snapshot.ciBinding.workflowId=999,x=>x.snapshot.ciBinding.headSha=C,x=>x.expected.ci=null,x=>{x.expected.ci.workflowId=999;x.snapshot.ciBinding.workflowId=999;}];
 for(const state of ['CI_WAIT','REVIEW_WAIT'])for(const edit of edits){const x=mailbox(fixture());if(state==='REVIEW_WAIT')x.ledger=change(x,'CI_PASSED',B);edit(x);const before=structuredClone(x.ledger);const r=reconcileContinuation(x);assert.equal(r.decision,'RECONCILE_EVENT');assert.equal(r.reason,'CI_BINDING_INVALID');assert.deepEqual(r.ledger,before);}
});
test('mailbox invalid CI binding revokes COMPLETE_DRAFT and preserves adverse-review precedence',()=>{
 const x=mailbox(fixture());x.ledger=reconcileContinuation(x).ledger;x.snapshot.ciBinding=null;const r=reconcileContinuation(x);assert.equal(r.reason,'CI_BINDING_INVALID');assert.equal(r.ledger.revoked,true);assert.equal(r.ledger.packets[0].state,'UNKNOWN_OUTCOME');
 const y=mailbox(fixture());y.ledger=reconcileContinuation(y).ledger;y.snapshot.ciBinding=null;y.snapshot.work.responses[0].verdict='REVISION_REQUIRED';const blocked=reconcileContinuation(y);assert.equal(blocked.reason,'STRICTEST_VERDICT');assert.equal(blocked.ledger.revoked,true);
});
test('missing mailbox CI only waits and valid mailbox CI_WAIT still advances',()=>{
 const x=mailbox(fixture());x.snapshot.work.ci=null;x.snapshot.ciBinding=null;x.expected.ci=null;const r=reconcileContinuation(x);assert.equal(r.decision,'WAITING_CI');assert.deepEqual(r.ledger,x.ledger);
 const y=mailbox(fixture());const ready=reconcileContinuation(y);assert.equal(ready.decision,'READY_FOR_OWNER_DECISION');assert.equal(ready.ledger.packets[0].state,'COMPLETE_DRAFT');
});

test('old GREEN cannot survive same-comment edit despite refreshed event identity',()=>{
 const x=mailbox(fixture());x.ledger=reconcileContinuation(x).ledger;
 const payload=JSON.parse(x.trigger.payloadJson);payload.action='edited';payload.comment.updated_at='2026-10-11T19:01:00Z';payload.comment.body='REVISION_REQUIRED';
 x.trigger.payloadJson=JSON.stringify(payload);bind(x);
 const r=reconcileContinuation(x);assert.equal(r.reason,'REVIEW_EVENT_VERSION_MISMATCH');assert.equal(r.ledger.revoked,true);noAuthority(r);
});
test('current CI cannot inherit review bound to a previous run on either wake',()=>{
 for(const mail of [false,true]){
  const x=mail?mailbox(fixture()):fixture();x.ledger=reconcileContinuation(x).ledger;
  x.expected.ci.runId=999;x.snapshot.ciBinding.runId=999;x.snapshot.work.ci.runId=999;
  if(!mail){const p=JSON.parse(x.trigger.payloadJson);p.workflow_run.id=999;x.trigger.payloadJson=JSON.stringify(p);bind(x);}
  const r=reconcileContinuation(x);assert.equal(r.reason,'REVIEW_BINDING_INVALID');assert.equal(r.ledger.revoked,true);
 }
});
test('missing provenance and independently changed comment version stop every ready state',()=>{
 for(const state of ['CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT'])for(const edit of [x=>x.snapshot.reviewBinding=null,x=>x.expected.reviewVersion=null,x=>x.expected.reviewVersion.bodySha256='e'.repeat(64),x=>x.snapshot.reviewBinding.ci.runAttempt=2]){
  const x=fixture();if(state!=='CI_WAIT')x.ledger=change(x,'CI_PASSED');if(state==='COMPLETE_DRAFT')x.ledger=change(x,'REVIEW_PASSED');edit(x);
  const r=reconcileContinuation(x);assert.equal(r.reason,'REVIEW_BINDING_INVALID');assert.notEqual(r.decision,'READY_FOR_OWNER_DECISION');
  if(state==='COMPLETE_DRAFT')assert.equal(r.ledger.revoked,true);else assert.deepEqual(r.ledger,x.ledger);
 }
});
test('one version sidecar cannot bless additional scoped GREEN responses',()=>{
 const x=fixture();x.snapshot.work.responses.push({...x.snapshot.work.responses[0],reviewCommentId:790});
 const r=reconcileContinuation(x);assert.equal(r.reason,'REVIEW_BINDING_INVALID');assert.deepEqual(r.ledger,x.ledger);
});
