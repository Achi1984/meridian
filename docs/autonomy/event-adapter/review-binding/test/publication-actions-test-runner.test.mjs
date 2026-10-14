import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPublicationTestRunner} from '../scripts/publication-actions-test-runner.mjs';
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
 environment:'publisher-test',subject:'repo:Achi1984/meridian:environment:publisher-test',approvalUpdatedAt:'2026-10-14T05:00:00Z',issuedAt:now-30,expiresAt:now+300};
 const scope=JSON.parse(f.scopeRaw);
 const snapshot={approval:{id:2222,actorId:config.ownerId,repositoryId:pins.repositoryId,issueNumber:571,
 body:approvalBody,updatedAt:config.approvalUpdatedAt},pr:{number:scope.prNumber,repositoryId:pins.repositoryId,
 headSha:scope.headSha,baseSha:scope.baseSha,state:'open'},ci:{repositoryId:pins.repositoryId,id:scope.ci.runId,
 runAttempt:scope.ci.runAttempt,workflowId:scope.ci.workflowId,headSha:scope.ci.headSha,status:'completed',conclusion:'success'},run:{repositoryId:pins.repositoryId,id:pins.runId,
 runAttempt:1,workflowId:pins.workflowId,workflowPath:pins.workflowPath,headSha:pins.controlSha,
 ref:pins.ref,event:pins.event,status:'in_progress'}};
 const claims={environment:config.environment,iss:'https://token.actions.githubusercontent.com',aud:'meridian-negative-publisher',sub:config.subject,
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

function hostSetup(store={reservation:null,record:null}){
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
function setup(store){
 const s=hostSetup(store),p=JSON.parse(s.config.pinsRaw),scope=JSON.parse(s.config.scopeRaw);
 const root='https://api.github.com/repos/Achi1984/meridian';
 const run=(id,workflowId,headSha,path,status)=>({id,url:root+'/actions/runs/'+id,
  repository:{id:p.repositoryId},head_repository:{id:p.repositoryId},run_attempt:1,
  workflow_id:workflowId,head_sha:headSha,head_branch:'main',path,event:'workflow_dispatch',
  status,conclusion:status==='completed'?'success':null});
 const approval={id:p.ownerApprovalCommentId,url:root+'/issues/comments/'+p.ownerApprovalCommentId,
  issue_url:root+'/issues/571',user:{id:s.config.ownerId,type:'User'},author_association:'OWNER',
  performed_via_github_app:null,body:s.snapshot.approval.body,updated_at:s.config.approvalUpdatedAt};
 const publisher=run(p.runId,p.workflowId,p.controlSha,p.workflowPath,'in_progress');
 const records=new Map([
  [root,{id:p.repositoryId,full_name:'Achi1984/meridian',owner:{id:s.config.ownerId,login:'Achi1984'}}],
  [approval.url,approval],
  [root+'/pulls/'+scope.prNumber,{number:scope.prNumber,url:root+'/pulls/'+scope.prNumber,
   base:{repo:{id:p.repositoryId},sha:scope.baseSha},head:{repo:{id:p.repositoryId},sha:scope.headSha},state:'open'}],
  [root+'/actions/runs/'+scope.ci.runId,run(scope.ci.runId,scope.ci.workflowId,scope.ci.headSha,'.github/workflows/check.yml','completed')],
  [root+'/actions/runs/'+p.runId,publisher]
 ]);
 const manifest={body:s.request.body,trustedConfig:s.config,
  hostContext:{repository:'Achi1984/meridian',actorId:s.config.ownerId,event:'workflow_dispatch',
   ref:'refs/heads/main',runAttempt:1,runId:p.runId,sha:p.controlSha},
  identityConfig:{requestUrl:'https://synthetic.actions.githubusercontent.com/oidc',endpointPin:'https://synthetic.actions.githubusercontent.com/oidc',
   requestToken:'identity-test',audience:'meridian-negative-publisher'},
  databaseConfig:{host:'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech',database:'publisher_test',reservation:{user:'reserve',password:'reserve-test'},
   senderRecord:{user:'sender',password:'sender-test'},sendRecordRead:{user:'reader',password:'reader-test'}}};
 let opens=0,closes=0,tokens=0,fetches=0;
 const pools={reservationPool:s.bootstrap.reservationPool,senderRecordPool:s.bootstrap.senderRecordPool,
  sendRecordReadPool:s.bootstrap.sendRecordReadPool,close:async()=>{closes++;}};
 const deps={acquireToken:async()=>{tokens++;return s.request.token;},openPools:async()=>{opens++;return pools;},
  readCredential:s.bootstrap.readCredential,clockMs:s.bootstrap.clockMs,monotonicMs:s.bootstrap.monotonicMs,
  fetchFn:async(url,options)=>{fetches++;
   if(options.method==='POST')return s.bootstrap.postFetch(url,options);
   if(url===s.comment.url)return s.bootstrap.commentFetch(url,options);
   if(records.has(url))return {status:200,url,redirected:false,body:new Response(JSON.stringify(records.get(url))).body};
   return s.deps.fetchFn(url,options);
  }};
 return {...s,manifest,deps,pools,approval,publisher,counts:()=>({opens,closes,tokens,fetches})};
}
function runnerSetup(store){
 const s=setup(store),constructed=[],ended=[],trace=[];
 const runnerEnv={ACTIONS_ID_TOKEN_REQUEST_URL:'https://synthetic.actions.githubusercontent.com/oidc',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN:'identity-test',GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',
  GITHUB_REPOSITORY:'Achi1984/meridian',GITHUB_ACTOR_ID:'319562141',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_REF:'refs/heads/main',GITHUB_SHA:JSON.parse(s.config.pinsRaw).controlSha,GITHUB_RUN_ID:'9000',GITHUB_RUN_ATTEMPT:'1'};
 const approved={body:s.request.body,trustedConfig:s.config};
 const {reservation,senderRecord,sendRecordRead}=s.manifest.databaseConfig;
 const roles={reservation,senderRecord,sendRecordRead};
 let tokenRequests=0,roleReads=0,manifestReads=0;
 class Pool{
  constructor(config){constructed.push(config);this.config=config;}
  on(){return this;}
  query(...args){return s.query(...args);}
  async end(){ended.push(this.config.user);}
 }
 const options={runnerEnv,Pool,databaseName:'publisher_test',clockMs:s.deps.clockMs,monotonicMs:s.deps.monotonicMs,deadlineMs:60000,
  readApprovedManifest:async()=>{manifestReads++;trace.push('manifest');return approved;},
  readRoleCredentials:async()=>{roleReads++;trace.push('roles');return roles;},
  readPublisherCredential:async()=>{trace.push('publisher');return s.bootstrap.readCredential();},
  fetchFn:async(url,opts)=>{
   if(url==='https://synthetic.actions.githubusercontent.com/oidc?audience=meridian-negative-publisher'){
    tokenRequests++;trace.push('identity');assert.equal(opts.headers.authorization,'Bearer identity-test');
    return {status:200,url,redirected:false,body:new Response(JSON.stringify({value:s.request.token})).body};
   }
   return s.deps.fetchFn(url,opts);
  }};
 return {...s,runnerEnv,approved,roles,options,constructed,ended,trace,
  runnerCounts:()=>({tokenRequests,roleReads,manifestReads})};
}
test('real runner identity pools preflight and host complete once with deferred publisher credential',async()=>{
 const s=runnerSetup(),run=createPublicationTestRunner(s.options),r=await run();
 assert.equal(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(r.stage,'CONFIRMATION');assert.equal(s.posts(),1);
 assert.deepEqual(s.trace,['manifest','roles','identity','publisher']);
 assert.deepEqual(s.events,['reserve','credential','post','retain','record','comment','record','settle']);
 assert.deepEqual(s.constructed.map(x=>x.user),['reserve','sender','reader']);assert.deepEqual(s.ended,['reserve','sender','reader']);
 for(const c of s.constructed){assert.equal(c.host,'ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech');
  assert.equal(c.database,'publisher_test');assert.equal(c.ssl.rejectUnauthorized,true);}
 assert.equal((await run()).outcome,'ALREADY_CONSUMED');assert.equal(s.posts(),1);
 for(const key of ['authenticated','authorized','durable','sendAllowed','dispatchAllowed','mergeAllowed'])assert.equal(r[key],false);
});
test('capture runner URL token context and callbacks before any manifest callback',async()=>{
 const s=runnerSetup();s.options.readApprovedManifest=async()=>{
  s.runnerEnv.ACTIONS_ID_TOKEN_REQUEST_URL='https://evil.invalid/';
  s.runnerEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN='MUTATED_SECRET';s.runnerEnv.GITHUB_RUN_ID='9999';
  s.options.fetchFn=()=>assert.fail('mutated transport');return s.approved;
 };
 assert.equal((await createPublicationTestRunner(s.options)()).outcome,'OBSERVED_CONFIRMATION');assert.equal(s.posts(),1);
});
test('invalid runner context rejected before callbacks or any network',()=>{
 for(const edit of [e=>delete e.ACTIONS_ID_TOKEN_REQUEST_URL,e=>e.ACTIONS_ID_TOKEN_REQUEST_URL='https://evil.invalid/',
  e=>e.ACTIONS_ID_TOKEN_REQUEST_URL='https://actions.githubusercontent.com.evil.invalid/',
  e=>e.ACTIONS_ID_TOKEN_REQUEST_TOKEN='',e=>e.GITHUB_REPOSITORY='other/repo',e=>e.GITHUB_RUN_ATTEMPT='2',
  e=>e.GITHUB_ACTOR_ID='1',e=>e.GITHUB_RUN_ID='1.1',e=>e.GITHUB_REF='refs/heads/other',e=>e.GITHUB_SHA='main',
  e=>e.GITHUB_EVENT_NAME='push',e=>e.GITHUB_ACTIONS='false',e=>e.RUNNER_ENVIRONMENT='self-hosted',
  e=>e.DATABASE_URL='PRIVATE_DATABASE_URL']){
  const s=runnerSetup();edit(s.runnerEnv);assert.throws(()=>createPublicationTestRunner(s.options),/^Error: TEST_RUNNER_CONFIGURATION_REJECTED$/);
  assert.deepEqual(s.runnerCounts(),{tokenRequests:0,roleReads:0,manifestReads:0});assert.equal(s.constructed.length,0);
 }
});
test('manifest secrets context overrides and unknown fields reject before role or token acquisition',async()=>{
 for(const edit of [m=>m.identityConfig={requestToken:'PRIVATE'},m=>m.databaseConfig={password:'PRIVATE'},
  m=>m.hostContext={runId:9001},m=>m.DATABASE_URL='PRIVATE',m=>m.trustedConfig.extra='PRIVATE',
  m=>m.trustedConfig.ownerId++,m=>delete m.trustedConfig.environment,
  m=>m.trustedConfig.subject='repo:Achi1984/meridian:ref:refs/heads/main',
  m=>{const p=JSON.parse(m.trustedConfig.pinsRaw);p.runId++;m.trustedConfig.pinsRaw=JSON.stringify(p);},
  m=>{const p=JSON.parse(m.trustedConfig.pinsRaw);p.controlSha='f'.repeat(40);m.trustedConfig.pinsRaw=JSON.stringify(p);},
  m=>m.body+='mutated']){
  const s=runnerSetup();edit(s.approved);const run=createPublicationTestRunner(s.options),r=await run();
  assert.equal(r.outcome,'REJECTED');assert.equal((await run()).outcome,'ALREADY_CONSUMED');
  assert.equal(s.runnerCounts().roleReads,0);assert.equal(s.runnerCounts().tokenRequests,0);assert.equal(s.constructed.length,0);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 }
});
test('expired manifest and expiry during role read reject without token acquisition',async()=>{
 for(const during of [false,true]){
  const s=runnerSetup();if(during)s.options.readRoleCredentials=async()=>{s.advance(400000);return s.roles;};
  else s.advance(400000);
  const r=await createPublicationTestRunner(s.options)();assert.equal(r.outcome,'REJECTED');
  assert.equal(s.runnerCounts().tokenRequests,0);assert.equal(s.constructed.length,0);
 }
});
test('manifest snapshot is immutable across role callback and secret errors remain sanitized',async()=>{
 const s=runnerSetup();s.options.readRoleCredentials=async()=>{s.approved.body='changed';s.config.environment='other';return s.roles;};
 assert.equal((await createPublicationTestRunner(s.options)()).outcome,'OBSERVED_CONFIRMATION');
 for(const name of ['readApprovedManifest','readRoleCredentials','readPublisherCredential']){
  const x=runnerSetup();x.options[name]=async()=>{throw Error('PRIVATE_SECRET');};
  const r=await createPublicationTestRunner(x.options)();assert.ok(!JSON.stringify(r).includes('PRIVATE_SECRET'));
  assert.notEqual(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(x.posts(),0);
 }
});
test('wrong environment subject must fail real signed-token checks before pools',async()=>{
 const s=runnerSetup();s.config.environment='different';s.config.subject='repo:Achi1984/meridian:environment:different';
 const r=await createPublicationTestRunner(s.options)();assert.equal(r.outcome,'REJECTED');
 assert.equal(s.runnerCounts().tokenRequests,1);assert.equal(s.constructed.length,0);assert.ok(!s.trace.includes('publisher'));
});
test('invalid role config cannot substitute the financial database or acquire identity',async()=>{
 for(const edit of [r=>r.host='financial.invalid',r=>r.DATABASE_URL='PRIVATE',
  r=>r.reservation.user='postgres',r=>r.sendRecordRead.password=r.reservation.password]){
  const s=runnerSetup();edit(s.roles);const r=await createPublicationTestRunner(s.options)();
  assert.notEqual(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(s.runnerCounts().tokenRequests,0);assert.equal(s.constructed.length,0);
 }
});
test('lost reservation ACK and restart never read publisher credential or resend',async()=>{
 const s=runnerSetup(),query=s.query;s.query=async()=>{};
 s.options.Pool=class{on(){return this;}async query(...args){await query(...args);throw Error('PRIVATE_DB');}async end(){}};
 const r=await createPublicationTestRunner(s.options)();assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.ok(!s.trace.includes('publisher'));assert.equal(s.posts(),0);
 const retry=runnerSetup(s.store);await createPublicationTestRunner(retry.options)();
 assert.ok(!retry.trace.includes('publisher'));assert.equal(retry.posts(),0);
});
test('pre-abort and abort during manifest callback consume runner without credentials',async()=>{
 for(const already of [true,false]){
  const s=runnerSetup(),c=new AbortController();let finish,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  if(already)c.abort();else s.options.readApprovedManifest=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
  const run=createPublicationTestRunner(s.options),work=run(c.signal);
  if(!already){await ready;c.abort();}
  assert.equal((await work).outcome,'REJECTED');assert.equal((await run()).outcome,'ALREADY_CONSUMED');
  if(!already){finish(s.approved);await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(s.runnerCounts().roleReads,0);assert.equal(s.runnerCounts().tokenRequests,0);assert.equal(s.constructed.length,0);
 }
});
test('manifest callback deadline is deterministic and late resolution cannot acquire secrets',async t=>{
 const s=runnerSetup();let entered,finish;s.options.deadlineMs=150;
 const ready=new Promise(resolve=>{entered=resolve;});
 s.options.readApprovedManifest=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 t.mock.timers.enable({apis:['setTimeout']});
 const run=createPublicationTestRunner(s.options),work=run();await ready;t.mock.timers.tick(150);
 const r=await work;assert.equal(r.outcome,'REJECTED');assert.equal(r.stage,'MANIFEST');
 finish(s.approved);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.runnerCounts().roleReads,0);assert.equal(s.runnerCounts().tokenRequests,0);
});
test('strict snapshots reject hidden behavior and non-JSON secret keys without invoking getters',async()=>{
 let getterCalls=0;
 const a=runnerSetup();Object.defineProperty(a.runnerEnv,'ACTIONS_ID_TOKEN_REQUEST_URL',{enumerable:true,get(){getterCalls++;return 'https://evil.invalid/';}});
 assert.throws(()=>createPublicationTestRunner(a.options),/^Error: TEST_RUNNER_CONFIGURATION_REJECTED$/);assert.equal(getterCalls,0);
 for(const edit of [m=>Object.defineProperty(m,'body',{enumerable:true,get(){getterCalls++;return 'PRIVATE';}}),
  m=>m.toJSON=()=>{getterCalls++;return {};},m=>m.password=undefined,m=>m.password=()=>{},
  m=>Object.defineProperty(m,'password',{value:'PRIVATE',enumerable:false}),m=>m[Symbol('password')]='PRIVATE',
  m=>m.self=m]){
  const s=runnerSetup();edit(s.approved);const r=await createPublicationTestRunner(s.options)();
  assert.equal(r.outcome,'REJECTED');assert.equal(s.runnerCounts().roleReads,0);assert.equal(s.runnerCounts().tokenRequests,0);
 }
 assert.equal(getterCalls,0);
});
test('database name is captured independently of manifest and cannot be replaced by credential callback',async()=>{
 const s=runnerSetup();s.options.databaseName='explicit_test_db';
 s.options.readRoleCredentials=async()=>{s.options.databaseName='financial';return s.roles;};
 assert.equal((await createPublicationTestRunner(s.options)()).outcome,'OBSERVED_CONFIRMATION');
 assert.ok(s.constructed.every(c=>c.database==='explicit_test_db'));
 for(const databaseName of ['',undefined,'db?sslmode=disable','postgres://secret']){
  const x=runnerSetup();x.options.databaseName=databaseName;assert.throws(()=>createPublicationTestRunner(x.options),/^Error: TEST_RUNNER_CONFIGURATION_REJECTED$/);
 }
});
test('abort during role credential callback rejects late secrets before identity or pools',async()=>{
 const s=runnerSetup(),c=new AbortController();let entered,finish;
 const ready=new Promise(resolve=>{entered=resolve;});
 s.options.readRoleCredentials=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 const run=createPublicationTestRunner(s.options),work=run(c.signal);await ready;c.abort();
 assert.equal((await work).outcome,'REJECTED');finish(s.roles);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.runnerCounts().tokenRequests,0);assert.equal(s.constructed.length,0);assert.equal((await run()).outcome,'ALREADY_CONSUMED');
});
