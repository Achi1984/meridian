// Disposable-harness extension only. Synthetic GitHub/OIDC; no network fallback.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPublicationHost} from './publication-host.mjs';
import {createPublicationRecovery} from './publication-recovery.mjs';
import {prepareAdmission} from './publication-service.mjs';
function fixture(label){
const cwd=fileURLToPath(new URL('../test/',import.meta.url));
// Actual shared envelope producer, not a hand-built imitation of its digest rules.
const fixture=spawnSync('python3',['-B','-c',`import json,sys
from test_review_evidence_contract import NegativePublicationTests,produce,contract
c,a,e,p=NegativePublicationTests().candidate()
for value in [c,e,*a['checks']]:
 value['requestId']='HOST-'+sys.argv[1]
 value['opId']='DB-'+sys.argv[1]
print(json.dumps({'body':produce(c,a,e,p),'scopeRaw':json.dumps(e),'policyRaw':json.dumps(p),'scopeSha256':contract.digest(e),'policySha256':contract.digest(contract.policy_checked(json.dumps(p)))}))`,label],{cwd,encoding:'utf8',timeout:10000});
assert.equal(fixture.status,0);const f=JSON.parse(fixture.stdout);
const hash=s=>createHash('sha256').update(s).digest('hex'),now=Math.floor(Date.now()/1000);
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'service-test',use:'sig',alg:'RS256'};
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
 const deps={clock:()=>now,readEvidence:async()=>snapshot,fetchFn:async(url)=>{
 assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
 return {status:200,url,redirected:false,body:new Response(JSON.stringify({keys:[jwk]})).body};}};
 return {request,config,snapshot,deps};
}

const ROOT='https://api.github.com/repos/Achi1984/meridian';
const FLAGS=['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'];
function inactive(result){for(const name of FLAGS)assert.equal(result[name],false);}
const SNAPSHOT_SQL=`SELECT r.operation_key,r.intent_sha256,r.body_sha256,r.run_id::text AS run_id,
 r.run_attempt,r.status,r.comment_id::text AS comment_id,
 floor(extract(epoch FROM r.created_at)*1000)::bigint::text AS reserved_at_ms,
 s.comment_id::text AS retained_comment_id
 FROM meridian_publisher.reservations r LEFT JOIN meridian_publisher.send_records s USING(operation_key)
 WHERE r.operation_key=ANY($1::text[]) ORDER BY r.operation_key`;

// The enclosing harness owns Docker/env gates. Schema and limited roles must
// already exist. All pools here use its fixed loopback-only pool factory.
export async function checkPublicationHostPostgres({admin,app,pool}){
 let sender,reader,checks=0,syntheticPosts=0;
 const expected=[];
 try{
  sender=pool({user:'sender_test_role',password:'isolated-sender-only'});
  reader=pool({user:'reader_test_role',password:'isolated-reader-only'});
  async function scenario(label,id){
   const f=fixture(label);let posts=0,comment;
   const postFetch=async(url,options)=>{
    assert.equal(url,ROOT+'/issues/571/comments');assert.equal(options.method,'POST');
    assert.equal(options.headers.authorization,'Bearer isolated_fake_token');
    assert.equal(JSON.parse(options.body).body,f.request.body);posts++;syntheticPosts++;
    const timestamp=new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z');
    comment={id,url:ROOT+'/issues/comments/'+id,issue_url:ROOT+'/issues/571',
     user:{id:4321,type:'Bot'},body:f.request.body,created_at:timestamp,updated_at:timestamp};
    return {status:201,url,redirected:false,body:new Response(JSON.stringify(comment)).body};
   };
   const commentFetch=async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(url,ROOT+'/issues/comments/'+id);assert.ok(comment);
    return {status:200,url,redirected:false,body:new Response(JSON.stringify(comment)).body};
   };
   const bootstrap={trustedConfig:f.config,reservationPool:app,senderRecordPool:sender,sendRecordReadPool:reader,
    readEvidence:f.deps.readEvidence,oidcFetch:f.deps.fetchFn,postFetch,commentFetch,
    readCredential:async()=> 'isolated_fake_token'};
   const admission=await prepareAdmission(f.request,f.config,f.deps);
   assert.equal(admission.kind,'UNAUTHENTICATED_ADMISSION_CANDIDATE');
   const recover=()=>createPublicationRecovery(f.config,{pool:app,senderRecordReadPool:reader,
    readEvidence:f.deps.readEvidence,fetchFn:(url,options)=>url===ROOT+'/issues/comments/'+id
     ?commentFetch(url,options):f.deps.fetchFn(url,options)})( {...f.request,commentId:id});
   return {bootstrap,request:f.request,recover,posts:()=>posts,binding:admission.ledgerBinding,id};
  }
  async function checkRow(s,status,retained){
   const rows=await admin.query(SNAPSHOT_SQL,[[s.binding.operationKey]]);assert.equal(rows.rowCount,1);
   const row=rows.rows[0];
   assert.equal(row.operation_key,s.binding.operationKey);assert.equal(row.intent_sha256,s.binding.intentSha256);
   assert.equal(row.body_sha256,s.binding.bodySha256);assert.equal(row.run_id,String(s.binding.runId));
   assert.equal(row.run_attempt,1);assert.equal(row.status,status);
   assert.equal(row.comment_id,status==='CONFIRMED'?String(s.id):null);
   assert.equal(row.retained_comment_id,retained?String(s.id):null);
   assert.match(row.reserved_at_ms,/^[1-9][0-9]+$/);assert.ok(Number(row.reserved_at_ms)<=Date.now());
   expected.push(Object.freeze({...row}));checks++;
  }
  const success=await scenario('success',41001);
  const completed=await createPublicationHost(success.bootstrap)(success.request);inactive(completed);
  assert.equal(completed.stage,'CONFIRMATION');assert.equal(completed.outcome,'ACKNOWLEDGED');
  assert.equal(success.posts(),1);await checkRow(success,'CONFIRMED',true);

  const race=await scenario('race',41002);
  const raced=await Promise.all([createPublicationHost(race.bootstrap)(race.request),createPublicationHost(race.bootstrap)(race.request)]);
  raced.forEach(inactive);assert.deepEqual(raced.map(r=>r.outcome).sort(),['ACKNOWLEDGED','NOT_ACQUIRED']);
  assert.equal(race.posts(),1);await checkRow(race,'CONFIRMED',true);

  const retained=await scenario('retained',41003);
  const stalled=await createPublicationHost({...retained.bootstrap,commentFetch:async()=>{throw Error('SIMULATED_GET_OUTAGE');}})(retained.request);
  inactive(stalled);assert.equal(stalled.stage,'CONFIRMATION');assert.equal(stalled.outcome,'REJECTED');
  const recovered=await retained.recover();inactive(recovered);assert.equal(recovered.outcome,'OBSERVED_CONFIRMATION');
  assert.equal(retained.posts(),1);await checkRow(retained,'CONFIRMED',true);

  const missing=await scenario('missing',41004),actualPost=missing.bootstrap.postFetch;
  const uncertain=await createPublicationHost({...missing.bootstrap,postFetch:async(...args)=>{
   await actualPost(...args);throw Error('SIMULATED_LOST_POST_RESPONSE');}})(missing.request);
  inactive(uncertain);assert.equal(uncertain.outcome,'UNCERTAIN');
  const absent=await missing.recover();inactive(absent);assert.equal(absent.outcome,'OWNER_RECONCILIATION_REQUIRED');
  assert.equal((await createPublicationHost(missing.bootstrap)(missing.request)).outcome,'NOT_ACQUIRED');
  assert.equal(missing.posts(),1);await checkRow(missing,'RESERVED',false);

  const lostReserve=await scenario('lost-reserve',41005);
  const reserveLost=await createPublicationHost({...lostReserve.bootstrap,reservationPool:{query:async(...args)=>{
   await app.query(...args);throw Error('SIMULATED_LOST_RESERVE_ACK');}}})(lostReserve.request);
  inactive(reserveLost);assert.equal(reserveLost.outcome,'UNCERTAIN');
  assert.equal((await createPublicationHost(lostReserve.bootstrap)(lostReserve.request)).outcome,'NOT_ACQUIRED');
  assert.equal(lostReserve.posts(),0);await checkRow(lostReserve,'RESERVED',false);

  const lostRetain=await scenario('lost-retain',41006);
  const retainLost=await createPublicationHost({...lostRetain.bootstrap,senderRecordPool:{query:async(...args)=>{
   await sender.query(...args);throw Error('SIMULATED_LOST_RETAIN_ACK');}}})(lostRetain.request);
  inactive(retainLost);assert.equal(retainLost.stage,'CAPTURE');assert.equal(retainLost.outcome,'UNCERTAIN');
  const retainRecovery=await lostRetain.recover();inactive(retainRecovery);
  assert.equal(retainRecovery.outcome,'OBSERVED_CONFIRMATION');assert.equal(lostRetain.posts(),1);
  await checkRow(lostRetain,'CONFIRMED',true);
  assert.equal(syntheticPosts,5);
  return {checks,syntheticPosts,restartState:Object.freeze(expected.sort((a,b)=>a.operation_key.localeCompare(b.operation_key))),
   productionDurability:false,sendAllowed:false};
 }finally{await Promise.allSettled([sender?.end(),reader?.end()]);}
}

// Read-only exact persistence check after the enclosing disposable-container kill.
// No credential, host reconstruction, POST or recovery promotion occurs here.
export async function checkPublicationHostRestart(admin,state){
 assert.equal(state.length,6);
 const rows=await admin.query(SNAPSHOT_SQL,[state.map(row=>row.operation_key)]);
 assert.deepEqual(rows.rows,state);return 1;
}

