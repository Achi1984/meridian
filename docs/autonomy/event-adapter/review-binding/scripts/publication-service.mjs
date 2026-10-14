// Inactive service composition. No routes, credentials, dispatch or sender.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyPublicationToken} from './publication-oidc.mjs';
import {reserve,settle} from './publication-ledger.mjs';
const bridge=fileURLToPath(new URL('./publication-plan-bridge.py',import.meta.url));
const flags={authenticated:false,provenanceVerified:false,authorized:false,
 dispatchAllowed:false,mergeAllowed:false,durable:false,sendAllowed:false};
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
function need(ok){if(!ok)throw new Error('rejected');}
function equal(a,b){return typeof a===typeof b&&a===b;}
async function boundedRead(reader){
 const abort=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new Error('deadline'));},5000);});
 try{return await Promise.race([Promise.resolve().then(()=>reader(abort.signal)),deadline]);}
 finally{clearTimeout(timer);abort.abort();}
}
function planFor(body,config){
 const input=JSON.stringify({body,scopeRaw:config.scopeRaw,policyRaw:config.policyRaw,pinsRaw:config.pinsRaw});
 need(Buffer.byteLength(input)<=65536);
 const child=spawnSync('python3',['-I','-B',bridge],{input,encoding:'utf8',timeout:10000,
  maxBuffer:32768,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',LANG:'C',LC_ALL:'C'}});
 need(!child.error&&child.status===0);const plan=JSON.parse(child.stdout);
 need(plan.kind==='OFFLINE_ACTIONS_PUBLICATION_PLAN');return plan;
}
function evidenceMatches(snapshot,config,plan,now){
 // Snapshot MUST come from the host's fixed authenticated readers. Comparisons
 // do not authenticate input records by themselves; callers cannot supply readers.
 const {pins,scope}=plan.intent;
 need(snapshot&&Object.keys(snapshot).sort().join()==='approval,ci,pr,run');
 const {approval,ci,pr,run}=snapshot;
 need(approval&&Object.keys(approval).sort().join()==='actorId,body,id,issueNumber,repositoryId,updatedAt');
 need(equal(approval.id,pins.ownerApprovalCommentId)&&equal(approval.actorId,config.ownerId)
  &&equal(approval.repositoryId,pins.repositoryId)&&approval.issueNumber===571);
 need(typeof approval.body==='string'&&Buffer.byteLength(approval.body)<=8192
  &&hash(approval.body)===pins.ownerApprovalBodySha256&&approval.updatedAt===config.approvalUpdatedAt);
 need(pr&&Object.keys(pr).sort().join()==='baseSha,headSha,number,repositoryId,state');
 need(equal(pr.repositoryId,pins.repositoryId)&&equal(pr.number,scope.prNumber)
  &&pr.headSha===scope.headSha&&pr.baseSha===scope.baseSha&&pr.state==='open');
 need(ci&&Object.keys(ci).sort().join()==='conclusion,headSha,id,repositoryId,runAttempt,status,workflowId');
 const expectedCi={repositoryId:pins.repositoryId,id:scope.ci.runId,runAttempt:scope.ci.runAttempt,
  workflowId:scope.ci.workflowId,headSha:scope.ci.headSha,status:'completed',conclusion:'success'};
 need(Object.entries(expectedCi).every(([key,value])=>equal(ci[key],value)));
 need(run&&Object.keys(run).sort().join()==='event,headSha,id,ref,repositoryId,runAttempt,status,workflowId,workflowPath');
 const expected={repositoryId:pins.repositoryId,id:pins.runId,runAttempt:1,
  workflowId:pins.workflowId,workflowPath:pins.workflowPath,headSha:pins.controlSha,
  ref:pins.ref,event:pins.event,status:'in_progress'};
 need(Object.entries(expected).every(([key,value])=>equal(run[key],value)));
 need(Number.isSafeInteger(now)&&Number.isSafeInteger(config.expiresAt)&&now<config.expiresAt
  &&Number.isSafeInteger(config.issuedAt)&&config.issuedAt<=now&&config.expiresAt-config.issuedAt<=900);
}
export async function prepareAdmission({token,body},trustedConfig,{readEvidence,fetchFn,clock=()=>Math.floor(Date.now()/1000)}={}){
 try{
  // Snapshot trusted bootstrap configuration before any asynchronous work.
  const config=JSON.parse(JSON.stringify(trustedConfig));
  need(Object.keys(config).sort().join()==='approvalUpdatedAt,expiresAt,issuedAt,ownerId,pinsRaw,policyRaw,scopeRaw,subject');
  need(Number.isSafeInteger(config.ownerId)&&config.ownerId>0&&typeof config.approvalUpdatedAt==='string');
  need(typeof body==='string'&&Buffer.byteLength(body)<=8192&&typeof token==='string'&&token.length<=16384);
  const plan=planFor(body,config),pins=plan.intent.pins;
  const identity=await verifyPublicationToken(token,{repositoryId:String(pins.repositoryId),
   ownerId:String(config.ownerId),runId:String(pins.runId),controlSha:pins.controlSha,subject:config.subject},{fetchFn,clock});
  need(identity.tokenVerified===true);
  // Reader is deployment-injected, not read from the request/config or JWT.
  const snapshot=await boundedRead(readEvidence);
  evidenceMatches(snapshot,config,plan,clock());
  // Freshness must be rechecked across the evidence await; do not fetch keys twice.
  need(Number.isSafeInteger(clock())&&clock()<identity.validUntil);
  return {kind:'UNAUTHENTICATED_ADMISSION_CANDIDATE',ledgerBinding:{operationKey:plan.operationKey,
   intentSha256:plan.intentSha256,bodySha256:pins.bodySha256,runId:pins.runId,runAttempt:1},...flags};
 }catch{return {kind:'ADMISSION_REJECTED',...flags};}
}
export async function reserveAdmission(request,trustedConfig,dependencies){
 // Only deployment code may supply dependencies/config; never an HTTP request.
 const candidate=await prepareAdmission(request,trustedConfig,dependencies);
 if(candidate.kind!=='UNAUTHENTICATED_ADMISSION_CANDIDATE')return candidate;
 const result=await reserve(dependencies.pool,candidate.ledgerBinding);
 return {kind:'INACTIVE_RESERVATION_RESULT',outcome:result.outcome,...flags};
}

export async function confirmPublication(request,trustedConfig,dependencies){
 // Inactive host composition: readers/pool/config must not come from HTTP input.
 try{
  const config=JSON.parse(JSON.stringify(trustedConfig));
  need(request&&Object.keys(request).sort().join()==='body,commentId,token');
  const {body,token,commentId}=request;
  need(Number.isSafeInteger(commentId)&&commentId>0);
  const input={body,token};
  const before=await prepareAdmission(input,config,dependencies);
  need(before.kind==='UNAUTHENTICATED_ADMISSION_CANDIDATE');
  const pins=JSON.parse(config.pinsRaw);
  const rawComment=await boundedRead(signal=>dependencies.readPublishedComment(commentId,signal));
  const comment={id:rawComment?.id,url:rawComment?.url,issueUrl:rawComment?.issue_url,
   actorId:rawComment?.user?.id,actorType:rawComment?.user?.type,body:rawComment?.body,
   createdAt:rawComment?.created_at,updatedAt:rawComment?.updated_at};
  const root='https://api.github.com/repos/Achi1984/meridian';
  need(comment?.id===commentId&&comment.url===`${root}/issues/comments/${commentId}`
   &&comment.issueUrl===`${root}/issues/571`&&comment.actorId===pins.publisherActorId
   &&comment.actorType==='Bot'&&comment.body===body);
  need(typeof comment.createdAt==='string'
   &&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(comment.createdAt)
   &&Number(comment.createdAt.slice(0,4))>0&&comment.updatedAt===comment.createdAt
   &&new Date(comment.createdAt).toISOString()===comment.createdAt.replace('Z','.000Z'));
  // Revalidate token, approval, PR and run after the additional network await.
  // The comment's shared bot identity alone is not workflow provenance.
  const after=await prepareAdmission(input,config,dependencies);
  need(after.kind==='UNAUTHENTICATED_ADMISSION_CANDIDATE'
   &&JSON.stringify(before.ledgerBinding)===JSON.stringify(after.ledgerBinding));
  const result=await settle(dependencies.pool,after.ledgerBinding,'CONFIRMED',commentId);
  return {kind:'INACTIVE_CONFIRMATION_RESULT',outcome:result.outcome,...flags};
 }catch{return {kind:'CONFIRMATION_REJECTED',...flags};}
}
