import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {prepareAdmission,reserveAdmission,confirmPublication} from '../scripts/publication-service.mjs';
import {createPublishedCommentReader} from '../scripts/publication-github-reader.mjs';
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
function setup(){
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
 return {request,config,snapshot,deps,calls:()=>calls};
}
test('actual contract and crypto feed one parameterized reservation, never send',async()=>{
 const s=setup();const r=await reserveAdmission(s.request,s.config,s.deps);
 assert.equal(r.kind,'INACTIVE_RESERVATION_RESULT');assert.equal(r.outcome,'ACKNOWLEDGED');assert.equal(s.calls(),1);
 for(const k of ['authenticated','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'])assert.equal(r[k],false);
});
test('wrapper or body substitution is rejected before identity/evidence/database',async()=>{
 for(const body of ['Claude finished\n'+f.body,f.body+'\n']){
 const s=setup();s.request.body=body;s.deps.fetchFn=()=>assert.fail('must not fetch');
 assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);}
});
test('forged token cannot cause database admission',async()=>{
 const s=setup();s.request.token=s.request.token.slice(0,-4)+'aaaa';s.deps.readEvidence=()=>assert.fail('must not read');
 assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);
});
test('changed owner approval PR run or attempt is rejected before reservation',async()=>{
 for(const edit of [s=>s.approval.actorId++,s=>s.approval.body+='changed',s=>s.approval.updatedAt='changed',
 s=>s.pr.headSha='f'.repeat(40),s=>s.pr.baseSha='f'.repeat(40),s=>s.pr.state='closed',
 s=>s.run.id++,s=>s.run.runAttempt=2,s=>s.run.workflowId++,s=>s.run.status='completed',
 s=>s.ci.conclusion='failure',s=>s.ci.headSha='f'.repeat(40),s=>s.ci.runAttempt++]){
 const s=setup();edit(s.snapshot);assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);}
});
test('approval expiry and expiry during evidence await are rejected',async()=>{
 for(const advance of [false,true]){const s=setup();if(!advance)s.config.expiresAt=now;
 // Use a stable clock callback with a mutable instant for the awaited case.
 let time=now;if(advance){s.deps.clock=()=>time;s.deps.readEvidence=async()=>{time=now+400;return s.snapshot;};}
 assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);}
});
test('token expiry during evidence await blocks even a still-valid approval',async()=>{
 const s=setup();s.config.expiresAt=now+600;let time=now;s.deps.clock=()=>time;
 s.deps.readEvidence=async()=>{time=now+295;return s.snapshot;};
 assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);
});
test('database conflict and ambiguous result propagate without retry',async()=>{
 for(const fail of [false,true]){const s=setup();let calls=0;s.deps.pool.query=async()=>{calls++;if(fail)throw new Error('private');return {rowCount:0,rows:[]};};
 const r=await reserveAdmission(s.request,s.config,s.deps);assert.equal(r.outcome,fail?'UNCERTAIN':'NOT_ACQUIRED');assert.equal(calls,1);}
});
test('unresponsive evidence source times out before database call',async()=>{
 const s=setup();s.deps.readEvidence=()=>new Promise(()=>{});const started=Date.now();
 assert.equal((await reserveAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');
 assert.ok(Date.now()-started<8000);assert.equal(s.calls(),0);
});
test('untrusted extra config and arbitrary candidate do not bypass validators',async()=>{
 const s=setup();s.config.authorized=true;
 assert.equal((await prepareAdmission(s.request,s.config,s.deps)).kind,'ADMISSION_REJECTED');assert.equal(s.calls(),0);
});

function confirmation(){
 const s=setup();s.request.commentId=3333;
 const root='https://api.github.com/repos/Achi1984/meridian';
 const comment={id:3333,url:root+'/issues/comments/3333',issue_url:root+'/issues/571',
  user:{id:4321,type:'Bot'},body:s.request.body,
  created_at:'2026-10-14T06:00:00Z',updated_at:'2026-10-14T06:00:00Z'};
 s.deps.readPublishedComment=async()=>comment;
 let writes=0;
 s.deps.pool.query=async(sql,args)=>{writes++;
  assert.ok(sql.startsWith('UPDATE '));assert.equal(args[5],'CONFIRMED');assert.equal(args[6],3333);
  return{rowCount:1,rows:[{operation_key:args[0],intent_sha256:args[1],status:'CONFIRMED'}]};};
 return {...s,comment,writes:()=>writes};
}
test('confirmation uses real admission checks and one exact reserved-row settlement',async()=>{
 const s=confirmation();const r=await confirmPublication(s.request,s.config,s.deps);
 assert.equal(r.kind,'INACTIVE_CONFIRMATION_RESULT');assert.equal(r.outcome,'ACKNOWLEDGED');
 assert.equal(s.writes(),1);assert.equal(r.sendAllowed,false);assert.equal(r.provenanceVerified,false);
});
test('concrete GET reader composes with real admission and conditional settlement',async()=>{
 for(const bad of [false,true]){
  const s=confirmation();let reads=0;if(bad)s.comment.body+='changed';
  s.deps.readPublishedComment=createPublishedCommentReader({fetchFn:async(url,options)=>{
   reads++;assert.equal(url,s.comment.url);assert.equal(options.method,'GET');
   return {status:200,url,redirected:false,body:new Response(JSON.stringify(s.comment)).body};
  }});
  const r=await confirmPublication(s.request,s.config,s.deps);assert.equal(reads,1);
  assert.equal(r.kind,bad?'CONFIRMATION_REJECTED':'INACTIVE_CONFIRMATION_RESULT');
  assert.equal(s.writes(),bad?0:1);assert.equal(r.sendAllowed,false);
 }
});
test('wrong comment identity actor mailbox or original bytes cannot settle',async()=>{
 for(const edit of [c=>c.id++,c=>c.url+='x',c=>c.issue_url=c.issue_url.replace('571','572'),
 c=>c.user.id++,c=>c.user.type='User',c=>c.body+='\n']){
  const s=confirmation();edit(s.comment);
  assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
  assert.equal(s.writes(),0);
 }
});
test('revocation or token expiry during comment read blocks settlement',async()=>{
 for(const mode of ['approval','run','token']){
  const s=confirmation();let time=now;s.deps.clock=()=>time;
  s.deps.readPublishedComment=async()=>{
   if(mode==='approval')s.snapshot.approval.body+='revoked';
   if(mode==='run')s.snapshot.run.status='completed';
   if(mode==='token')time=now+295;
   return s.comment;
  };
  assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
  assert.equal(s.writes(),0);
 }
});
test('missing malformed calendar or edited timestamps cannot settle',async()=>{
 for(const stamp of [undefined,'2026-02-30T06:00:00Z','0000-01-01T00:00:00Z',
  '2026-10-14T06:00:00+00:00','2026-10-14T06:00:00.000Z','invalid']){
  const s=confirmation();s.comment.created_at=stamp;s.comment.updated_at=stamp;
  assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
  assert.equal(s.writes(),0);
 }
 const s=confirmation();s.comment.updated_at='2026-10-14T06:00:01Z';
 assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
 assert.equal(s.writes(),0);
});
test('confirmation snapshots input and config across awaited reads',async()=>{
 const s=confirmation();s.deps.readPublishedComment=async()=>{
  s.request.commentId=4444;s.request.body='mutated';s.config.pinsRaw='{}';return s.comment;
 };
 assert.equal((await confirmPublication(s.request,s.config,s.deps)).outcome,'ACKNOWLEDGED');
 assert.equal(s.writes(),1);
});
test('confirmation conflicts and lost DB replies never retry or grant authority',async()=>{
 for(const fail of [false,true]){const s=confirmation();let calls=0;
  s.deps.pool.query=async()=>{calls++;if(fail)throw new Error('private');return{rowCount:0,rows:[]};};
  const r=await confirmPublication(s.request,s.config,s.deps);
  assert.equal(r.outcome,fail?'UNCERTAIN':'NOT_ACQUIRED');assert.equal(calls,1);assert.equal(r.durable,false);
 }
});
test('stalled comment reader is bounded without settlement',async()=>{
 const s=confirmation();s.deps.readPublishedComment=()=>new Promise(()=>{});const start=Date.now();
 assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
 assert.equal(s.writes(),0);assert.ok(Date.now()-start<8000);
});
test('invalid confirmation request or forged token is rejected before comment read',async()=>{
 for(const mode of ['id','extra','token']){const s=confirmation();
  if(mode==='id')s.request.commentId=-1;if(mode==='extra')s.request.authorized=true;
  if(mode==='token')s.request.token='forged';
  s.deps.readPublishedComment=()=>assert.fail('must not read');
  assert.equal((await confirmPublication(s.request,s.config,s.deps)).kind,'CONFIRMATION_REJECTED');
  assert.equal(s.writes(),0);
 }
});
