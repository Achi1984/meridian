import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPublicationHost} from '../scripts/publication-host.mjs';
import {SETTLE_SQL} from '../scripts/publication-ledger.mjs';
import {READ_SQL,RETAIN_SQL} from '../scripts/publication-send-record.mjs';
import {RESERVE_RECEIPT_SQL} from '../scripts/publication-reservation-receipt.mjs';
const cwd=fileURLToPath(new URL('.',import.meta.url));
// Actual shared envelope producer, not a hand-built imitation of its digest rules.
const fixture=spawnSync('python3',['-B','-c',`import json
from test_review_evidence_contract import NegativePublicationTests,produce,contract
c,a,e,p=NegativePublicationTests().candidate()
print(json.dumps({'body':produce(c,a,e,p),'scopeRaw':json.dumps(e),'policyRaw':json.dumps(p),'scopeSha256':contract.digest(e),'policySha256':contract.digest(contract.policy_checked(json.dumps(p)))}))`],{cwd,encoding:'utf8',timeout:10000});
assert.equal(fixture.status,0);const f=JSON.parse(fixture.stdout);
const hash=s=>createHash('sha256').update(s).digest('hex'),now=1800000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'service-test',use:'sig',alg:'RS256'};
function cryptoFixture(){
 const approvalBody='Explicit bounded negative publication approval fixture.';
 const pins={repositoryId:1342084551,mailbox:571,bodySha256:hash(f.body),scopeSha256:f.scopeSha256,
 policySha256:f.policySha256,controlSha:'e'.repeat(40),workflowPath:'.github/workflows/meridian-negative-publisher.yml',
 workflowId:5678,runId:9000,runAttempt:1,event:'workflow_dispatch',ref:'refs/heads/main',publisherActorId:4321,
 ownerApprovalCommentId:2222,ownerApprovalBodySha256:hash(approvalBody)};
 const config={scopeRaw:f.scopeRaw,policyRaw:f.policyRaw,pinsRaw:JSON.stringify(pins),ownerId:319562141,
 subject:'repo:Achi1984/meridian:ref:refs/heads/main',approvalUpdatedAt:'2026-10-14T05:00:00Z',issuedAt:now-30,expiresAt:now+300};
 const scope=JSON.parse(f.scopeRaw);
 const snapshot={approval:{id:2222,actorId:config.ownerId,repositoryId:pins.repositoryId,issueNumber:571,
 body:approvalBody,updatedAt:config.approvalUpdatedAt},pr:{number:scope.prNumber,repositoryId:pins.repositoryId,
 headSha:scope.headSha,baseSha:scope.baseSha,state:'open'},ci:{repositoryId:pins.repositoryId,id:scope.ci.runId,
 runAttempt:scope.ci.runAttempt,workflowId:scope.ci.workflowId,headSha:scope.ci.headSha,status:'completed',conclusion:'success'},run:{repositoryId:pins.repositoryId,id:pins.runId,
 runAttempt:1,workflowId:pins.workflowId,workflowPath:pins.workflowPath,headSha:pins.controlSha,
 ref:pins.ref,event:pins.event,status:'in_progress'}};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'meridian-negative-publisher',sub:config.subject,
 repository:'Achi1984/meridian',repository_id:String(pins.repositoryId),repository_owner:'Achi1984',repository_owner_id:String(config.ownerId),
 ref:pins.ref,ref_type:'branch',workflow_ref:'Achi1984/meridian/'+pins.workflowPath+'@'+pins.ref,
 workflow_sha:pins.controlSha,sha:pins.controlSha,run_id:String(pins.runId),run_attempt:'1',event_name:pins.event,
 runner_environment:'github-hosted',jti:'service-test',iat:now-10,nbf:now-10,exp:now+290};
 const raw=[{alg:'RS256',typ:'JWT',kid:jwk.kid},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const request={body:f.body,token:raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')};
 let calls=0;
 const deps={clock:()=>now,readEvidence:async()=>snapshot,fetchFn:async(url)=>({status:200,url,redirected:false,
 body:new Response(JSON.stringify({keys:[jwk]})).body}),pool:{query:async(_sql,args)=>{calls++;return {rowCount:1,
 rows:[{operation_key:args[0],intent_sha256:args[1],status:'RESERVED'}]};}}};
 return {request,config,snapshot,deps};
}

function setup(store={reservation:null,record:null}){
 const s=cryptoFixture(),events=[];let wall=now*1000+123,mono=0,posts=0;
 const root='https://api.github.com/repos/Achi1984/meridian';
 const comment={id:3333,url:root+'/issues/comments/3333',issue_url:root+'/issues/571',
  user:{id:4321,type:'Bot'},body:s.request.body,created_at:new Date(now*1000).toISOString().replace('.000Z','Z')};
 comment.updated_at=comment.created_at;
 const rows=row=>({rowCount:row?1:0,rows:row?[row]:[]});
 const query=async(sql,args)=>{
  if(sql===RESERVE_RECEIPT_SQL){events.push('reserve');if(store.reservation)return rows(null);
   store.reservation={operation_key:args[0],intent_sha256:args[1],body_sha256:args[2],run_id:String(args[3]),
    run_attempt:args[4],status:'RESERVED',reserved_at_ms:String(wall)};return rows({...store.reservation});}
  const r=store.reservation;assert.ok(r);assert.equal(args[0],r.operation_key);
  if(sql===RETAIN_SQL){events.push('retain');if(store.record||r.status!=='RESERVED')return rows(null);
   store.record=String(args[5]);return rows({operation_key:r.operation_key,comment_id:store.record});}
  if(sql===READ_SQL){events.push('record');if(!store.record||r.status!=='RESERVED')return rows(null);
   const {status,reserved_at_ms,...binding}=r;return rows({...binding,comment_id:store.record});}
  assert.equal(sql,SETTLE_SQL);events.push('settle');if(r.status!=='RESERVED')return rows(null);
  assert.equal(args[5],'CONFIRMED');assert.equal(String(args[6]),store.record);r.status='CONFIRMED';
  return rows({operation_key:r.operation_key,intent_sha256:r.intent_sha256,status:r.status});
 };
 const bootstrap={trustedConfig:s.config,reservationPool:{query},senderRecordPool:{query},sendRecordReadPool:{query},
  readEvidence:async()=>{events.push('admission');return s.snapshot;},oidcFetch:s.deps.fetchFn,
  readCredential:async()=>{events.push('credential');return 'test_token';},clockMs:()=>wall,monotonicMs:()=>mono,
  postFetch:async(url)=>{events.push('post');posts++;wall+=120;mono+=120;
   return {status:201,url,redirected:false,body:new Response(JSON.stringify(comment)).body};},
  commentFetch:async(url)=>{events.push('comment');return {status:200,url,redirected:false,body:new Response(JSON.stringify(comment)).body};}};
 return {...s,store,events,comment,bootstrap,query,posts:()=>posts,advance:(w,m=0)=>{wall+=w;mono+=m;}};
}
test('actual whole composition reserves, sends once, retains and confirms with subsecond timestamps',async()=>{
 const s=setup(),run=createPublicationHost(s.bootstrap),r=await run(s.request);
 assert.equal(r.outcome,'ACKNOWLEDGED');assert.equal(r.stage,'CONFIRMATION');assert.equal(s.posts(),1);
 assert.deepEqual(s.events,['admission','reserve','credential','admission','post','admission','retain','admission','record','comment','record','admission','settle']);
 for(const key of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'])assert.equal(r[key],false);
 assert.equal((await run(s.request)).outcome,'ALREADY_CONSUMED');
});
test('lost reserve ACK and restart conflict never send',async()=>{
 const s=setup();s.bootstrap.reservationPool.query=async(...args)=>{await s.query(...args);throw Error('lost ACK');};
 assert.equal((await createPublicationHost(s.bootstrap)(s.request)).outcome,'UNCERTAIN');assert.equal(s.posts(),0);
 const next=setup(s.store);assert.equal((await createPublicationHost(next.bootstrap)(next.request)).outcome,'NOT_ACQUIRED');assert.equal(next.posts(),0);
});
test('two host instances competing for one reservation send at most once',async()=>{
 const a=setup(),b=setup(a.store);const results=await Promise.all([createPublicationHost(a.bootstrap)(a.request),createPublicationHost(b.bootstrap)(b.request)]);
 assert.equal(a.posts()+b.posts(),1);assert.ok(results.some(r=>r.outcome==='NOT_ACQUIRED'));
});
test('fresh admission after reserve rejects revocation and expired token',async()=>{
 for(const edit of [s=>s.snapshot.approval.body+='changed',s=>s.snapshot.pr.state='closed',s=>s.snapshot.run.status='completed',s=>s.advance(400000)]){
  const s=setup();s.bootstrap.readCredential=async()=>{edit(s);return 'test_token';};
  assert.equal((await createPublicationHost(s.bootstrap)(s.request)).stage,'FRESH_ADMISSION');assert.equal(s.posts(),0);assert.ok(s.store.reservation);
 }
});
test('request/config/dependency mutations after bootstrap do not redirect or change operation',async()=>{
 const s=setup(),request={...s.request};s.bootstrap.readCredential=async()=>{
  request.body='mutated';s.config.pinsRaw='{}';s.bootstrap.postFetch=()=>assert.fail('mutated dependency');
  s.bootstrap.senderRecordPool.query=()=>assert.fail('mutated pool');return 'test_token';};
 assert.equal((await createPublicationHost(s.bootstrap)(request)).outcome,'ACKNOWLEDGED');assert.equal(s.posts(),1);
});
test('caller cannot supply receipts time windows endpoints or config',async()=>{
 for(const key of ['publicationWindow','reservation','url','trustedConfig','commentId']){
 const s=setup();assert.equal((await createPublicationHost(s.bootstrap)({...s.request,[key]:{}})).outcome,'REJECTED');assert.equal(s.events.length,0);}
});
test('wrong actor body and old/future comment time never retained',async()=>{
 for(const edit of [c=>c.user.id++,c=>c.body+='x',c=>{c.created_at=c.updated_at='2020-01-01T00:00:00Z';},c=>{c.created_at=c.updated_at='2090-01-01T00:00:00Z';}]){
 const s=setup();edit(s.comment);assert.equal((await createPublicationHost(s.bootstrap)(s.request)).stage,'CAPTURE');assert.equal(s.posts(),1);assert.equal(s.store.record,null);}
});
test('POST accepted then response lost is uncertain and never resent by restart',async()=>{
 const s=setup();let attempts=0;s.bootstrap.postFetch=async()=>{attempts++;throw Error('lost response');};
 assert.equal((await createPublicationHost(s.bootstrap)(s.request)).outcome,'UNCERTAIN');assert.equal(attempts,1);
 const next=setup(s.store);await createPublicationHost(next.bootstrap)(next.request);assert.equal(next.posts(),0);assert.equal(s.store.record,null);
});
test('retention and settlement lost ACK never report completion or retry',async()=>{
 for(const sql of [RETAIN_SQL,SETTLE_SQL]){const s=setup();const pool=sql===RETAIN_SQL?s.bootstrap.senderRecordPool:s.bootstrap.reservationPool;
 pool.query=async(query,args)=>{const result=await s.query(query,args);if(query===sql)throw Error('lost ACK');return result;};
 assert.equal((await createPublicationHost(s.bootstrap)(s.request)).outcome,'UNCERTAIN');assert.equal(s.posts(),1);assert.equal(s.events.filter(x=>x==='post').length,1);}
});
test('abort with pending reserve and its late ACK cannot reach POST',async()=>{
 const s=setup(),abort=new AbortController();let release,entered;
 const ready=new Promise(r=>entered=r);s.bootstrap.reservationPool.query=async(...args)=>{const result=await s.query(...args);entered();return new Promise(r=>release=()=>r(result));};
 const pending=createPublicationHost(s.bootstrap)(s.request,abort.signal);await ready;abort.abort();
 assert.equal((await pending).outcome,'UNCERTAIN');release();await new Promise(r=>setImmediate(r));assert.equal(s.posts(),0);assert.equal(s.store.record,null);
});
test('deadline with pending admission and late continuation cannot reserve or POST',async()=>{
 const s=setup();let release;s.bootstrap.deadlineMs=100;s.bootstrap.readEvidence=()=>new Promise(r=>release=()=>r(s.snapshot));
 const result=await createPublicationHost(s.bootstrap)(s.request);assert.equal(result.outcome,'REJECTED');
 release?.();await new Promise(r=>setImmediate(r));assert.equal(s.posts(),0);assert.equal(s.store.reservation,null);
});
test('wallclock rollback and excessive monotonic send duration fail closed',async()=>{
 for(const [wall,mono] of [[-1000,0],[0,4501]]){const s=setup(),post=s.bootstrap.postFetch;
 s.bootstrap.postFetch=async(...args)=>{const r=await post(...args);s.advance(wall,mono);return r;};
 assert.equal((await createPublicationHost(s.bootstrap)(s.request)).outcome,'UNCERTAIN');assert.equal(s.store.record,null);}
});
test('late capture or final confirmation admission after abort cannot write',async()=>{
 for(const blockAt of [3,5]){
  const s=setup(),abort=new AbortController();let release,entered,reads=0;
  const ready=new Promise(r=>entered=r);s.bootstrap.readEvidence=async()=>{
   if(++reads===blockAt){entered();return new Promise(r=>release=()=>r(s.snapshot));}return s.snapshot;};
  const pending=createPublicationHost(s.bootstrap)(s.request,abort.signal);await ready;abort.abort();
  assert.equal((await pending).outcome,'UNCERTAIN');release();await new Promise(r=>setImmediate(r));
  assert.equal(s.posts(),1);assert.equal(s.events.includes('settle'),false);
  assert.equal(s.store.record,blockAt===3?null:'3333');
 }
});
test('changed readback or missing retained record prevents confirmation',async()=>{
 for(const mode of ['body','record']){const s=setup();
  if(mode==='body')s.bootstrap.commentFetch=async url=>({status:200,url,redirected:false,
   body:new Response(JSON.stringify({...s.comment,body:'changed'})).body});
  else s.bootstrap.sendRecordReadPool.query=async()=>({rowCount:0,rows:[]});
  const result=await createPublicationHost(s.bootstrap)(s.request);assert.equal(result.stage,'CONFIRMATION');
  assert.equal(result.outcome,'REJECTED');assert.equal(s.events.includes('settle'),false);assert.equal(s.posts(),1);
 }
});
test('malformed abort signal returns generic rejection without cleanup exception',async()=>{
 const s=setup();const result=await createPublicationHost(s.bootstrap)(s.request,
  {aborted:false,addEventListener(){},removeEventListener:'bad'});
 assert.equal(result.outcome,'REJECTED');assert.equal(s.posts(),0);assert.equal(s.store.reservation,null);
});

