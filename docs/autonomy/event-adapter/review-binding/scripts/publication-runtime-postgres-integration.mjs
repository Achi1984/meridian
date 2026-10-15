// Explicit disposable-local integration only. Import starts no processes or connections.
// GitHub/OIDC are synthetic; the fixture remaps the production pool configuration
// to loopback TLS. This does not prove Neon routing or authorize publication.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPublicationDatabaseReadiness} from './publication-database-readiness.mjs';
import {createPublicationTestRunner} from './publication-actions-test-runner.mjs';
import {RESERVE_RECEIPT_SQL} from './publication-reservation-receipt.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const root='https://api.github.com/repos/Achi1984/meridian';
const identityUrl='https://synthetic.actions.githubusercontent.com/oidc';
const diagnostics=new WeakMap();
const fixtureFailures=new Set(['IMAGE','CERTIFICATES','CREATE','START','PORT','STARTUP','VERSION',
 'SCHEMA','ROLES','GRANTS','RUNTIME','TLS_CA','TLS_HOSTNAME','TLS_REQUIRED'].map(s=>'LOCAL_TLS_POSTGRES_FIXTURE_FAILED_'+s));
const snapshotSql=`SELECT r.operation_key,r.status,r.comment_id::text,
 s.comment_id::text AS retained_comment_id FROM meridian_publisher.reservations r
 LEFT JOIN meridian_publisher.send_records s USING(operation_key) WHERE r.run_id=$1`;

function scenario(label,runId,key){
 const produced=spawnSync('python3',['-B','-c',`import json,sys
from test_review_evidence_contract import NegativePublicationTests,produce,contract
c,a,e,p=NegativePublicationTests().candidate()
for value in [c,e,*a['checks']]:
 value['requestId']='RUNTIME-'+sys.argv[1]
 value['opId']='RUNTIME-'+sys.argv[1]
print(json.dumps({'body':produce(c,a,e,p),'scopeRaw':json.dumps(e),'policyRaw':json.dumps(p),'scopeSha256':contract.digest(e),'policySha256':contract.digest(contract.policy_checked(json.dumps(p)))}))`,label],
 {cwd:fileURLToPath(new URL('../test/',import.meta.url)),encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 assert.equal(produced.status,0,'synthetic envelope producer failed');
 const f=JSON.parse(produced.stdout),now=Math.floor(Date.now()/1000);
 const approvalBody='Synthetic local runtime integration approval.';
 const pins={repositoryId:1342084551,mailbox:571,bodySha256:hash(f.body),scopeSha256:f.scopeSha256,
  policySha256:f.policySha256,controlSha:'e'.repeat(40),workflowPath:'.github/workflows/meridian-negative-publisher.yml',
  workflowId:5678,runId,runAttempt:1,event:'workflow_dispatch',ref:'refs/heads/main',publisherActorId:4321,
  ownerApprovalCommentId:2222,ownerApprovalBodySha256:hash(approvalBody)};
 const config={scopeRaw:f.scopeRaw,policyRaw:f.policyRaw,pinsRaw:JSON.stringify(pins),ownerId:319562141,
  environment:'publisher-test',subject:'repo:Achi1984/meridian:environment:publisher-test',
  approvalUpdatedAt:new Date((now-30)*1000).toISOString().replace('.000Z','Z'),issuedAt:now-30,expiresAt:now+300};
 const claims={environment:config.environment,iss:'https://token.actions.githubusercontent.com',aud:'meridian-negative-publisher',sub:config.subject,
  repository:'Achi1984/meridian',repository_id:String(pins.repositoryId),repository_owner:'Achi1984',repository_owner_id:String(config.ownerId),
  ref:pins.ref,ref_type:'branch',workflow_ref:'Achi1984/meridian/'+pins.workflowPath+'@'+pins.ref,
  workflow_sha:pins.controlSha,sha:pins.controlSha,run_id:String(runId),run_attempt:'1',event_name:pins.event,
  runner_environment:'github-hosted',jti:'local-runtime-'+label,iat:now-10,nbf:now-10,exp:now+290};
 const token=()=>{const raw=[{alg:'RS256',typ:'JWT',kid:key.jwk.kid},claims]
  .map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),key.privateKey).toString('base64url');};
 const scope=JSON.parse(f.scopeRaw);
 const run=(id,workflowId,headSha,path,status)=>({id,url:root+'/actions/runs/'+id,
  repository:{id:pins.repositoryId},head_repository:{id:pins.repositoryId},run_attempt:1,
  workflow_id:workflowId,head_sha:headSha,head_branch:'main',path,event:'workflow_dispatch',status,
  conclusion:status==='completed'?'success':null});
 const records=new Map([
  [root,{id:pins.repositoryId,full_name:'Achi1984/meridian',owner:{id:config.ownerId,login:'Achi1984'}}],
  [root+'/issues/comments/2222',{id:2222,url:root+'/issues/comments/2222',issue_url:root+'/issues/571',
   user:{id:config.ownerId,type:'User'},author_association:'OWNER',performed_via_github_app:null,
   body:approvalBody,updated_at:config.approvalUpdatedAt}],
  [root+'/pulls/'+scope.prNumber,{number:scope.prNumber,url:root+'/pulls/'+scope.prNumber,
   base:{repo:{id:pins.repositoryId},sha:scope.baseSha},head:{repo:{id:pins.repositoryId},sha:scope.headSha},state:'open'}],
  [root+'/actions/runs/'+scope.ci.runId,run(scope.ci.runId,scope.ci.workflowId,scope.ci.headSha,'.github/workflows/check.yml','completed')],
  [root+'/actions/runs/'+runId,run(runId,pins.workflowId,pins.controlSha,pins.workflowPath,'in_progress')]
 ]);
 let posts=0,credentials=0,losePostAck=false;
 const fetchFn=async(url,options={})=>{
  let value,status=200;
  if(url===identityUrl+'?audience=meridian-negative-publisher'){
   assert.equal(options.headers.authorization,'Bearer identity-test');value={value:token()};
  }else if(url==='https://token.actions.githubusercontent.com/.well-known/jwks')value={keys:[key.jwk]};
  else if(options.method==='POST'){
   assert.equal(url,root+'/issues/571/comments');assert.equal(JSON.parse(options.body).body,f.body);posts++;
   const stamp=new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z');
   const id=runId+10000;value={id,url:root+'/issues/comments/'+id,issue_url:root+'/issues/571',
    user:{id:4321,type:'Bot'},body:f.body,created_at:stamp,updated_at:stamp};
   records.set(value.url,value);status=201;
   if(losePostAck)throw new Error('synthetic lost response');
  }else{assert.ok(records.has(url),'unrecognized synthetic GitHub endpoint');value=records.get(url);}
  return {status,url,redirected:false,body:new Response(JSON.stringify(value)).body};
 };
 const options=(fixture,Pool=fixture.Pool)=>({Pool,databaseName:fixture.config.database,
  runnerEnv:{ACTIONS_ID_TOKEN_REQUEST_URL:identityUrl,ACTIONS_ID_TOKEN_REQUEST_TOKEN:'identity-test',
   GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_REPOSITORY:'Achi1984/meridian',
   GITHUB_ACTOR_ID:String(config.ownerId),GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:pins.ref,
   GITHUB_SHA:pins.controlSha,GITHUB_RUN_ID:String(runId),GITHUB_RUN_ATTEMPT:'1'},
  readApprovedManifest:async()=>({body:f.body,trustedConfig:config}),
  readRoleCredentials:async()=>Object.fromEntries(['reservation','senderRecord','sendRecordRead'].map(k=>[k,fixture.config[k]])),
  readPublisherCredential:async()=>{credentials++;return 'synthetic_publisher_token';},fetchFn,
  clockMs:Date.now,monotonicMs:()=>performance.now(),deadlineMs:60000});
 return {runId,claims,options,counts:()=>({posts,credentials}),losePostAck:()=>{losePostAck=true;}};
}

// Offline fixture seam: actual envelope producer and signed tokens, no database.
export function createSyntheticRuntimeScenario(label,runId){
 assert.match(label,/^[a-z-]{1,40}$/);assert.ok(Number.isSafeInteger(runId)&&runId>0);
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 return scenario(label,runId,{privateKey:pair.privateKey,
  jwk:{...pair.publicKey.export({format:'jwk'}),kid:'local-runtime',use:'sig',alg:'RS256'}});
}

export async function checkPublicationRuntimePostgres(fixture){
 const passed=[];let stage='FIXTURE_CONTRACT';
 try{
 assert.equal(fixture?.kind,'DISPOSABLE_LOOPBACK_PG16_TLS','local fixture capability required');
 assert.equal(typeof fixture.Pool,'function');assert.equal(typeof fixture.admin?.query,'function');
 assert.equal(typeof fixture.verifyTransportRejections,'function');
 stage='TRANSPORT';
 await fixture.verifyTransportRejections();passed.push('transport-rejections');
 stage='CATALOG_READINESS';
 const readiness=()=>createPublicationDatabaseReadiness(fixture.config,{Pool:fixture.Pool})();
 assert.equal((await readiness()).outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');passed.push('catalog-readiness');
 const user=fixture.config.reservation.user;
 assert.match(user,/^[a-z][a-z0-9_]{0,62}$/);
 stage='TIMESTAMP_GRANT_DRIFT';
 const timestampPrivilege=async expected=>{
  const answer=await fixture.admin.query(`SELECT pg_catalog.has_column_privilege($1,
   'meridian_publisher.reservations','created_at','INSERT') AS allowed`,[user]);
  assert.equal(answer.rowCount,1);assert.equal(answer.rows[0]?.allowed,expected);
 };
 await timestampPrivilege(false);
 await fixture.admin.query(`GRANT INSERT(created_at) ON meridian_publisher.reservations TO "${user}"`);
 try{await timestampPrivilege(true);assert.equal((await readiness()).outcome,'SCOPED_CHECKS_FAILED');}
 finally{await fixture.admin.query(`REVOKE INSERT(created_at) ON meridian_publisher.reservations FROM "${user}"`);}
 await timestampPrivilege(false);
 assert.equal((await readiness()).outcome,'SCOPED_READ_ONLY_CHECKS_PASSED');passed.push('timestamp-grant-drift');
 stage='ENVIRONMENT_RUNNER';
 const pair=generateKeyPairSync('rsa',{modulusLength:2048});
 const key={privateKey:pair.privateKey,jwk:{...pair.publicKey.export({format:'jwk'}),kid:'local-runtime',use:'sig',alg:'RS256'}};
 const rows=async s=>(await fixture.admin.query(snapshotSql,[s.runId])).rows;
 const execute=(s,Pool)=>createPublicationTestRunner(s.options(fixture,Pool))();
 const success=scenario('success',9101,key);
 const successful=await execute(success);assert.equal(successful.outcome,'OBSERVED_CONFIRMATION');
 for(const flag of ['authenticated','authorized','durable','sendAllowed','dispatchAllowed','mergeAllowed'])assert.equal(successful[flag],false);
 let state=await rows(success);assert.equal(state.length,1);assert.equal(state[0].status,'CONFIRMED');
 assert.equal(state[0].comment_id,state[0].retained_comment_id);assert.ok(state[0].comment_id);
 assert.equal((await execute(success)).outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.deepEqual(await rows(success),state);assert.deepEqual(success.counts(),{posts:1,credentials:1});
 passed.push('environment-runner-success-and-replay');
 stage='CONCURRENT_ONE_SEND';
 const race=scenario('race',9102,key);
 const outcomes=await Promise.all([execute(race),execute(race)]);
 assert.equal(outcomes.filter(r=>r.outcome==='OBSERVED_CONFIRMATION').length,1);
 assert.equal(outcomes.filter(r=>r.outcome==='OWNER_RECONCILIATION_REQUIRED').length,1);
 assert.deepEqual(race.counts(),{posts:1,credentials:1});
 state=await rows(race);assert.equal(state.length,1);assert.equal(state[0].status,'CONFIRMED');
 assert.ok(state[0].comment_id);assert.equal(state[0].comment_id,state[0].retained_comment_id);
 passed.push('concurrent-one-send');
 stage='LOST_RESERVATION_ACK';
 const reserve=scenario('reserve-ack',9103,key);
 class LostReservePool extends fixture.Pool{
  async query(sql,...args){const result=await super.query(sql,...args);
   if(sql===RESERVE_RECEIPT_SQL&&result.rowCount===1)throw new Error('synthetic lost reserve ACK');return result;}
 }
 assert.equal((await execute(reserve,LostReservePool)).outcome,'OWNER_RECONCILIATION_REQUIRED');
 state=await rows(reserve);assert.equal(state.length,1);assert.equal(state[0].status,'RESERVED');
 assert.equal(state[0].retained_comment_id,null);
 assert.equal((await execute(reserve)).outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.deepEqual(await rows(reserve),state);assert.deepEqual(reserve.counts(),{posts:0,credentials:0});
 passed.push('lost-reservation-ack-no-send');
 stage='LOST_POST_ACK';
 const post=scenario('post-ack',9104,key);post.losePostAck();
 assert.equal((await execute(post)).outcome,'OWNER_RECONCILIATION_REQUIRED');
 state=await rows(post);assert.equal(state.length,1);assert.equal(state[0].status,'RESERVED');
 assert.equal(state[0].retained_comment_id,null);
 assert.equal((await execute(post)).outcome,'OWNER_RECONCILIATION_REQUIRED');
 assert.deepEqual(await rows(post),state);assert.deepEqual(post.counts(),{posts:1,credentials:1});
 passed.push('lost-post-ack-no-resend');
 stage='WRONG_ENVIRONMENT';
 const invalid=scenario('wrong-environment',9105,key);invalid.claims.environment='foreign';
 let opens=0;class CountPool extends fixture.Pool{constructor(options){super(options);opens++;}}
 assert.equal((await execute(invalid,CountPool)).outcome,'REJECTED');
 assert.equal(opens,0);assert.deepEqual(await rows(invalid),[]);assert.deepEqual(invalid.counts(),{posts:0,credentials:0});
 passed.push('wrong-environment-before-pool');
 return Object.freeze({outcome:'LOCAL_RUNTIME_INTEGRATION_PASSED',checks:Object.freeze(passed),
  syntheticGitHub:true,productionRoutingVerified:false,liveAuthorized:false});
 }catch{
  const error=new Error('LOCAL_RUNTIME_INTEGRATION_FAILED');
  const detail=Object.freeze({stage,passed:Object.freeze([...passed])});
  Object.assign(error,detail);diagnostics.set(error,detail);throw error;
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let code=1,output={outcome:'LOCAL_RUNTIME_INTEGRATION_NOT_REQUESTED',liveAuthorized:false};
 if(process.argv.length===3&&process.argv[2]==='--local-pg16-tls'){
  let runtimeDiagnostic;
  try{
   const {Pool}=await import('pg');
   const {withPublicationTlsPostgres}=await import('./publication-local-tls-fixture.mjs');
   output=await withPublicationTlsPostgres({optIn:'LOCAL_PG16_TLS_ONLY',Pool},async fixture=>{
    try{return await checkPublicationRuntimePostgres(fixture);}
    catch(error){runtimeDiagnostic=diagnostics.get(error);throw error;}
   });code=0;
  }catch(error){
   const message=error?.message;
   const detail=message==='LOCAL_TLS_POSTGRES_FIXTURE_FAILED_RUNTIME'&&runtimeDiagnostic
    ?runtimeDiagnostic:{stage:message==='LOCAL_TLS_POSTGRES_CLEANUP_UNCONFIRMED'?'CLEANUP_UNCONFIRMED':
     fixtureFailures.has(message)?message.slice('LOCAL_TLS_POSTGRES_FIXTURE_FAILED_'.length):'DEPENDENCY_OR_FIXTURE',passed:[]};
   output={outcome:'LOCAL_RUNTIME_INTEGRATION_FAILED_OR_CLEANUP_UNCONFIRMED',...detail,liveAuthorized:false};
  }
 }
 process.stdout.write(JSON.stringify(output)+'\n');process.exitCode=code;
}
