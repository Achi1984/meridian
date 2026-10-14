import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createPublicationRecovery} from '../scripts/publication-recovery.mjs';
import {READ_SQL} from '../scripts/publication-send-record.mjs';
import {SETTLE_SQL} from '../scripts/publication-ledger.mjs';

const fixture=spawnSync('python3',['-B','-c',`import json
from test_review_evidence_contract import NegativePublicationTests,produce,contract
c,a,e,p=NegativePublicationTests().candidate()
print(json.dumps({'body':produce(c,a,e,p),'scopeRaw':json.dumps(e),'policyRaw':json.dumps(p),'scopeSha256':contract.digest(e),'policySha256':contract.digest(contract.policy_checked(json.dumps(p)))}))`],
 {cwd:fileURLToPath(new URL('.',import.meta.url)),encoding:'utf8',timeout:10000});
assert.equal(fixture.status,0);const f=JSON.parse(fixture.stdout);
const now=1800000000,root='https://api.github.com/repos/Achi1984/meridian';
const hash=s=>createHash('sha256').update(s).digest('hex');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'recovery-test',use:'sig',alg:'RS256'};
function setup(){
 const approvalBody='Explicit bounded negative publication approval fixture.';
 const pins={repositoryId:1342084551,mailbox:571,bodySha256:hash(f.body),scopeSha256:f.scopeSha256,
  policySha256:f.policySha256,controlSha:'e'.repeat(40),workflowPath:'.github/workflows/meridian-negative-publisher.yml',
  workflowId:5678,runId:9000,runAttempt:1,event:'workflow_dispatch',ref:'refs/heads/main',publisherActorId:4321,
  ownerApprovalCommentId:2222,ownerApprovalBodySha256:hash(approvalBody)};
 const config={scopeRaw:f.scopeRaw,policyRaw:f.policyRaw,pinsRaw:JSON.stringify(pins),ownerId:319562141,
  subject:'repo:Achi1984/meridian:ref:refs/heads/main',approvalUpdatedAt:'2026-10-14T05:00:00Z',issuedAt:now-30,expiresAt:now+300};
 const scope=JSON.parse(f.scopeRaw);
 const evidence={approval:{id:2222,actorId:config.ownerId,repositoryId:pins.repositoryId,issueNumber:571,
  body:approvalBody,updatedAt:config.approvalUpdatedAt},pr:{number:scope.prNumber,repositoryId:pins.repositoryId,
  headSha:scope.headSha,baseSha:scope.baseSha,state:'open'},ci:{repositoryId:pins.repositoryId,id:scope.ci.runId,
  runAttempt:scope.ci.runAttempt,workflowId:scope.ci.workflowId,headSha:scope.ci.headSha,status:'completed',conclusion:'success'},
  run:{repositoryId:pins.repositoryId,id:pins.runId,runAttempt:1,workflowId:pins.workflowId,
   workflowPath:pins.workflowPath,headSha:pins.controlSha,ref:pins.ref,event:pins.event,status:'in_progress'}};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:'meridian-negative-publisher',sub:config.subject,
  repository:'Achi1984/meridian',repository_id:String(pins.repositoryId),repository_owner:'Achi1984',repository_owner_id:String(config.ownerId),
  ref:pins.ref,ref_type:'branch',workflow_ref:'Achi1984/meridian/'+pins.workflowPath+'@'+pins.ref,
  workflow_sha:pins.controlSha,sha:pins.controlSha,run_id:String(pins.runId),run_attempt:'1',event_name:pins.event,
  runner_environment:'github-hosted',jti:'recovery-test',iat:now-10,nbf:now-10,exp:now+290};
 const raw=[{alg:'RS256',typ:'JWT',kid:jwk.kid},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
 const request={body:f.body,commentId:3333,token:raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')};
 const comment={id:3333,url:root+'/issues/comments/3333',issue_url:root+'/issues/571',user:{id:4321,type:'Bot'},
  body:f.body,created_at:'2026-10-14T06:00:00Z',updated_at:'2026-10-14T06:00:00Z'};
 const state={present:true,recordId:3333,settlements:0,records:0,comments:0,http:0};
 const deps={clock:()=>now,readEvidence:async()=>evidence,
  fetchFn:async(url,options)=>{
   state.http++;assert.equal(options.method??'GET','GET');assert.equal(options.headers?.authorization,undefined);
   let payload;if(url===comment.url){state.comments++;payload=comment;}
   else{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');payload={keys:[jwk]};}
   return {status:200,url,redirected:false,body:new Response(JSON.stringify(payload)).body};
  },senderRecordReadPool:{query:async(sql,args)=>{
   assert.equal(sql,READ_SQL);state.records++;
   return !state.present?{rowCount:0,rows:[]}:{rowCount:1,rows:[{operation_key:args[0],intent_sha256:args[1],
    body_sha256:args[2],run_id:String(args[3]),run_attempt:args[4],comment_id:String(state.recordId)}]};
  }},pool:{query:async(sql,args)=>{
   assert.equal(sql,SETTLE_SQL);state.settlements++;assert.equal(args[5],'CONFIRMED');assert.equal(args[6],3333);
   state.present=false;return {rowCount:1,rows:[{operation_key:args[0],intent_sha256:args[1],status:'CONFIRMED'}]};
  }}};
 return {config,request,comment,evidence,deps,state};
}
const falseFlags=r=>{for(const key of ['authenticated','provenanceVerified','authorized','dispatchAllowed','mergeAllowed','durable','sendAllowed'])assert.equal(r[key],false);};
test('recovery source has no sender reservation credential or enumeration capability',()=>{
 const source=readFileSync(new URL('../scripts/publication-recovery.mjs',import.meta.url),'utf8');
 const imports=[...source.matchAll(/^import .*$/gm)].map(m=>m[0]);
 assert.equal(imports.length,3);assert.match(imports[0],/\{confirmPublication\}/);
 assert.match(imports[1],/\{createPublishedCommentReader\}/);assert.match(imports[2],/\{createSendRecordReader\}/);
 assert.doesNotMatch(source,/publication-post-transport|retainSendRecord|reserveAdmission|process\.env|authorization:|\.\/publication-reservation/);
});
test('actual confirmation and concrete GET/SQL readers settle only an existing matching record',async()=>{
 const s=setup(),recover=createPublicationRecovery(s.config,s.deps);
 const r=await recover(s.request);assert.equal(r.outcome,'OBSERVED_CONFIRMATION');falseFlags(r);
 assert.equal(s.state.records,2);assert.equal(s.state.comments,1);assert.equal(s.state.settlements,1);
});
test('missing or mismatched record requires owner reconciliation without comment lookup or settlement',async()=>{
 for(const missing of [false,true]){
  const s=setup();if(missing)s.state.present=false;else s.state.recordId=4444;
  const r=await createPublicationRecovery(s.config,s.deps)(s.request);
  assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');falseFlags(r);
  assert.equal(s.state.comments,0);assert.equal(s.state.settlements,0);
 }
});
test('new recovery instance never rebuilds records or resends after terminal state',async()=>{
 const s=setup();assert.equal((await createPublicationRecovery(s.config,s.deps)(s.request)).outcome,'OBSERVED_CONFIRMATION');
 const r=await createPublicationRecovery(s.config,s.deps)(s.request);
 assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(s.state.settlements,1);assert.equal(s.state.comments,1);
});
test('wrong comment content and approval revocation prevent settlement',async()=>{
 for(const changedComment of [false,true]){
  const s=setup();if(changedComment)s.comment.body+='changed';else s.evidence.approval.body+='revoked';
  assert.equal((await createPublicationRecovery(s.config,s.deps)(s.request)).outcome,'OWNER_RECONCILIATION_REQUIRED');
  assert.equal(s.state.settlements,0);
 }
});
test('config request and original methods are pinned across awaited evidence',async()=>{
 const s=setup();const original=s.deps.pool;let receiver;
 const query=original.query;original.query=async function(...args){receiver=this;return query(...args);};
 let reads=0;s.deps.readEvidence=async()=>{
  if(++reads===1){s.request.body='changed';s.request.commentId=4444;s.config.pinsRaw='{}';
   original.query=()=>assert.fail('replaced query');s.deps.pool={query:()=>assert.fail('replaced pool')};
   s.deps.readEvidence=()=>assert.fail('replaced evidence');s.deps.fetchFn=()=>assert.fail('replaced fetch');}
  return s.evidence;
 };
 const r=await createPublicationRecovery(s.config,s.deps)(s.request);
 assert.equal(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(receiver,original);assert.equal(s.state.settlements,1);
});
test('pre-abort malformed request and forged token cannot settle',async()=>{
 for(const mode of ['abort','extra','token']){
  const s=setup();if(mode==='extra')s.request.publicationWindow={};if(mode==='token')s.request.token='forged';
  const r=await createPublicationRecovery(s.config,s.deps)(s.request,mode==='abort'?AbortSignal.abort():undefined);
  assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(s.state.settlements,0);assert.equal(s.state.comments,0);
  if(mode!=='token')assert.equal(s.state.http,0);
 }
});
test('mutated parent cleanup method cannot prevent final abort or expose an error',async()=>{
 const s=setup(),parent=new AbortController(),signals=[];let replacementCalls=0;
 const fetch=s.deps.fetchFn;
 s.deps.fetchFn=(url,options)=>{signals.push(options.signal);return fetch(url,options);};
 s.deps.readEvidence=async()=>{
  parent.signal.removeEventListener=()=>{replacementCalls++;throw Error('private cleanup error');};
  return s.evidence;
 };
 const r=await createPublicationRecovery(s.config,s.deps)(s.request,parent.signal);
 assert.equal(r.outcome,'OBSERVED_CONFIRMATION');assert.equal(replacementCalls,0);
 assert.equal(s.state.settlements,1);assert.ok(signals.length>0);
 assert.ok(signals.every(signal=>signal.aborted));falseFlags(r);
});
test('deadline rejects pending evidence and late resolution cannot initiate settlement',async()=>{
 const s=setup();let release,enteredResolve;
 const entered=new Promise(r=>enteredResolve=r);
 s.deps.readEvidence=()=>{enteredResolve();return new Promise(r=>release=r);};
 const recover=createPublicationRecovery(s.config,s.deps,{timeoutMs:1000});
 const pending=recover(s.request);await entered;
 assert.equal((await pending).outcome,'OWNER_RECONCILIATION_REQUIRED');
 release(s.evidence);await new Promise(r=>setImmediate(r));
 assert.equal(s.state.records,0);assert.equal(s.state.comments,0);assert.equal(s.state.settlements,0);
});
test('abort while final evidence is pending prevents late settlement',async()=>{
 const s=setup(),parent=new AbortController();let reads=0,release,enteredResolve;
 const entered=new Promise(r=>enteredResolve=r);
 s.deps.readEvidence=()=>++reads===1?Promise.resolve(s.evidence):new Promise(r=>{release=r;enteredResolve();});
 const pending=createPublicationRecovery(s.config,s.deps)(s.request,parent.signal);await entered;parent.abort();
 assert.equal((await pending).outcome,'OWNER_RECONCILIATION_REQUIRED');release(s.evidence);
 await new Promise(r=>setImmediate(r));assert.equal(s.state.settlements,0);
});
test('settlement conflict or lost reply is reconciliation only and never retried',async()=>{
 for(const lost of [false,true]){
  const s=setup();s.deps.pool.query=async()=>{s.state.settlements++;if(lost)throw Error('private secret');return {rowCount:0,rows:[]};};
  const r=await createPublicationRecovery(s.config,s.deps)(s.request);
  assert.equal(r.outcome,'OWNER_RECONCILIATION_REQUIRED');assert.equal(s.state.settlements,1);falseFlags(r);
  assert.ok(!JSON.stringify(r).includes('secret'));
 }
});
