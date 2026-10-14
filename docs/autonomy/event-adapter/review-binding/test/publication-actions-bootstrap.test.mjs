import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createActionsPublicationIdentity} from '../scripts/publication-actions-identity.mjs';
import {openPublicationPools} from '../scripts/publication-actions-pools.mjs';
import {createActionsPublicationBootstrap} from '../scripts/publication-actions-bootstrap.mjs';
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
  identityConfig:{requestUrl:'https://token.test.invalid/oidc',endpointPin:'https://token.test.invalid/oidc',
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
test('actual preflight and host confirm one signed environment publication and close pools',async()=>{
 const s=setup(),run=createActionsPublicationBootstrap(s.manifest,s.deps),r=await run();
 assert.equal(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(r.stage,'CONFIRMATION');assert.equal(s.posts(),1);
 assert.deepEqual(s.events,['reserve','credential','post','retain','record','comment','record','settle']);
 assert.equal(s.counts().opens,1);assert.equal(s.counts().closes,1);assert.equal(s.counts().tokens,1);
 for(const k of ['authenticated','authorized','durable','sendAllowed','dispatchAllowed','mergeAllowed'])assert.equal(r[k],false);
 assert.equal((await run()).outcome,'ALREADY_CONSUMED');assert.equal(s.posts(),1);
});
test('invalid manifest or context fails before identity DB and network effects',()=>{
 for(const edit of [m=>delete m.trustedConfig.environment,m=>m.hostContext.runAttempt=2,
  m=>m.hostContext.event='push',m=>m.hostContext.actorId++,m=>m.extra=true,
  m=>m.trustedConfig.extra=true,m=>delete m.databaseConfig,m=>m.identityConfig.requestUrl='http://evil.invalid/',
  m=>m.databaseConfig.host='evil.invalid',m=>m.databaseConfig.reservation.user='postgres',
  m=>m.databaseConfig.reservation.password='',m=>m.trustedConfig.subject='repo:Achi1984/meridian:ref:refs/heads/main']){
  const s=setup();edit(s.manifest);
  assert.throws(()=>createActionsPublicationBootstrap(s.manifest,s.deps),/^Error: ACTIONS_BOOTSTRAP_CONFIGURATION_REJECTED$/);
  assert.deepEqual(s.counts(),{opens:0,closes:0,tokens:0,fetches:0});
 }
});
test('invalid body and expired approval reject before acquiring identity',async()=>{
 for(const edit of [s=>s.manifest.body+='changed',s=>s.advance(400000)]){
  const s=setup();edit(s);const r=await createActionsPublicationBootstrap(s.manifest,s.deps)();
  assert.equal(r.outcome,'REJECTED');assert.deepEqual(s.counts(),{opens:0,closes:0,tokens:0,fetches:0});
 }
});
test('forged identity revoked approval and ended run prevent pool creation',async()=>{
 for(const edit of [s=>s.request.token+='bad',s=>s.approval.body+='revoked',s=>s.publisher.status='completed']){
  const s=setup();edit(s);const r=await createActionsPublicationBootstrap(s.manifest,s.deps)();
  assert.equal(r.outcome,'REJECTED');assert.equal(s.counts().opens,0);assert.equal(s.posts(),0);assert.equal(s.events.length,0);
 }
});
test('trusted manifest and adapter snapshot survives caller mutation',async()=>{
 const s=setup(),run=createActionsPublicationBootstrap(s.manifest,s.deps);
 s.manifest.body='mutated';s.manifest.trustedConfig.environment='other';s.deps.acquireToken=()=>assert.fail('mutated');
 assert.equal((await run()).outcome,'OBSERVED_CONFIRMATION');assert.equal(s.posts(),1);
});
test('lost reservation ACK remains consumed and never acquires publisher credential',async()=>{
 const s=setup();s.pools.reservationPool.query=async(...args)=>{await s.query(...args);throw Error('PRIVATE_DB');};
 const run=createActionsPublicationBootstrap(s.manifest,s.deps),r=await run();
 assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(s.posts(),0);
 assert.deepEqual(s.events,['reserve']);assert.equal(s.counts().closes,1);
 assert.equal((await run()).outcome,'ALREADY_CONSUMED');
 const restart=setup(s.store);assert.equal((await createActionsPublicationBootstrap(restart.manifest,restart.deps)()).outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.equal(restart.posts(),0);assert.deepEqual(restart.events,['reserve']);
});
test('lost POST response is not retried and cannot be resent after restart',async()=>{
 const s=setup();let posts=0;s.bootstrap.postFetch=async()=>{posts++;throw Error('PRIVATE_POST');};
 const run=createActionsPublicationBootstrap(s.manifest,s.deps);assert.equal((await run()).outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.equal(posts,1);assert.equal(s.counts().closes,1);assert.equal((await run()).outcome,'ALREADY_CONSUMED');
 const restart=setup(s.store);await createActionsPublicationBootstrap(restart.manifest,restart.deps)();assert.equal(restart.posts(),0);
});
test('pool initialization failure and cleanup failure return sanitized reconciliation outcomes',async()=>{
 for(const phase of ['open','close']){
  const s=setup();if(phase==='open')s.deps.openPools=async()=>{throw Error('PRIVATE_DATABASE_URL');};
  else s.pools.close=async()=>{throw Error('PRIVATE_DATABASE_URL');};
  const r=await createActionsPublicationBootstrap(s.manifest,s.deps)();
  assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  if(phase==='open')assert.equal(s.posts(),0);
 }
});
test('already aborted invocation consumes instance without any acquisition',async()=>{
 const s=setup(),c=new AbortController();c.abort();const run=createActionsPublicationBootstrap(s.manifest,s.deps);
 assert.equal((await run(c.signal)).outcome,'REJECTED');assert.equal((await run()).outcome,'ALREADY_CONSUMED');
 assert.deepEqual(s.counts(),{opens:0,closes:0,tokens:0,fetches:0});
});
test('abort during pool opening cleans late pools and cannot send',async()=>{
 const s=setup(),c=new AbortController();let finish,entered;
 const ready=new Promise(resolve=>{entered=resolve;});
 s.deps.openPools=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 const work=createActionsPublicationBootstrap(s.manifest,s.deps)(c.signal);
 await ready;c.abort();assert.equal((await work).outcome,'OWNER_RECONCILIATION_REQUIRED');
 finish(s.pools);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.counts().closes,1);assert.equal(s.posts(),0);assert.equal(s.events.length,0);
});
test('deadline bounds hung identity acquisition and late token cannot open pools',async()=>{
 const s=setup();let finish;s.deps.deadlineMs=150;
 s.deps.acquireToken=()=>new Promise(resolve=>{finish=resolve;});
 const run=createActionsPublicationBootstrap(s.manifest,s.deps),r=await run();
 assert.equal(r.outcome,'REJECTED');assert.equal(r.stage,'IDENTITY');
 finish(s.request.token);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.counts().opens,0);assert.equal(s.posts(),0);
});
test('revoked approval after reservation revalidates and never posts',async()=>{
 const s=setup();s.deps.readCredential=async()=>{s.approval.body+='revoked';return 'test_token';};
 const r=await createActionsPublicationBootstrap(s.manifest,s.deps)();
 assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(r.stage,'FRESH_ADMISSION');
 assert.equal(s.posts(),0);assert.equal(s.counts().closes,1);assert.ok(s.store.reservation);
});
test('abort after durable reservation blocks late credential and closes pools',async()=>{
 const s=setup(),c=new AbortController();let finish,entered;
 const ready=new Promise(resolve=>{entered=resolve;});
 s.deps.readCredential=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 const run=createActionsPublicationBootstrap(s.manifest,s.deps),work=run(c.signal);
 await ready;c.abort();const r=await work;
 assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(s.counts().closes,1);
 finish('test_token');await new Promise(resolve=>setImmediate(resolve));assert.equal(s.posts(),0);
 assert.equal((await run()).outcome,'ALREADY_CONSUMED');
});
test('real identity and pool adapters compose with actual signed-token preflight and host',async()=>{
 const s=setup(),constructed=[],ended=[];let acquisitions=0;
 s.deps.acquireToken=createActionsPublicationIdentity({fetchFn:async(url,options)=>{
  acquisitions++;assert.equal(url,s.manifest.identityConfig.requestUrl+'?audience=meridian-negative-publisher');
  assert.equal(options.headers.authorization,'Bearer identity-test');
  return {status:200,url,redirected:false,body:new Response(JSON.stringify({value:s.request.token})).body};
 }});
 class Pool{
  constructor(options){constructed.push(options);this.options=options;}
  on(name,listener){assert.equal(name,'error');assert.equal(typeof listener,'function');return this;}
  async query(...args){return s.query(...args);}
  async end(){ended.push(this.options.user);}
 }
 s.deps.openPools=config=>openPublicationPools(config,{Pool});
 const r=await createActionsPublicationBootstrap(s.manifest,s.deps)();
 assert.equal(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(acquisitions,1);assert.equal(s.posts(),1);
 assert.deepEqual(constructed.map(x=>x.user),['reserve','sender','reader']);
 assert.deepEqual(ended,['reserve','sender','reader']);
 for(const option of constructed){assert.equal(option.ssl.rejectUnauthorized,true);
  assert.equal(option.ssl.servername,s.manifest.databaseConfig.host);assert.equal(option.max,1);}
});
