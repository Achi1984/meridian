// Source-only one-shot composition. No environment lookup, CLI, startup or imports with effects.
// Deployment owns the manifest/adapters; passing JSON does not authenticate a host.
import {planForPublication} from './publication-plan-process.mjs';
import {preflightPublication} from './publication-run-preflight.mjs';
import {createPublicationHost} from './publication-host.mjs';
import {createGithubEvidenceReader} from './publication-github-reader.mjs';
const flags={authenticated:false,authorized:false,provenanceVerified:false,durable:false,
 dispatchAllowed:false,mergeAllowed:false,sendAllowed:false};
const result=(stage,outcome)=>({kind:'INACTIVE_ACTIONS_BOOTSTRAP_RESULT',stage,outcome,...flags});
function need(value){if(!value)throw Error('ACTIONS_BOOTSTRAP_REJECTED');}
function keys(value,expected){need(value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).sort().join()===expected);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function createActionsPublicationBootstrap(trustedManifest,dependencies){
 let manifest,acquireToken,openPools,fetchFn,readCredential,clockMs,monotonicMs,deadlineMs;
 try{
  manifest=freeze(JSON.parse(JSON.stringify(trustedManifest)));
  keys(manifest,'body,databaseConfig,hostContext,identityConfig,trustedConfig');
  const c=manifest.trustedConfig,h=manifest.hostContext;
  keys(c,'approvalUpdatedAt,environment,expiresAt,issuedAt,ownerId,pinsRaw,policyRaw,scopeRaw,subject');
  keys(h,'actorId,event,ref,repository,runAttempt,runId,sha');
  need(typeof manifest.body==='string'&&Buffer.byteLength(manifest.body)>0&&Buffer.byteLength(manifest.body)<=8192);
  need(typeof c.environment==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(c.environment));
  const p=JSON.parse(c.pinsRaw);JSON.parse(c.scopeRaw);JSON.parse(c.policyRaw);
  need(c.ownerId===319562141&&Number.isSafeInteger(p.repositoryId)&&p.repositoryId>0);
  need(c.subject===`repo:Achi1984/meridian:environment:${c.environment}`
   ||c.subject===`repo:Achi1984@${c.ownerId}/meridian@${p.repositoryId}:environment:${c.environment}`);
  need(h.repository==='Achi1984/meridian'&&h.actorId===c.ownerId&&h.event==='workflow_dispatch'
   &&h.ref==='refs/heads/main'&&h.runAttempt===1&&h.runId===p.runId&&h.sha===p.controlSha);
  need(Number.isSafeInteger(c.issuedAt)&&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>c.issuedAt
   &&c.expiresAt-c.issuedAt<=900&&typeof c.approvalUpdatedAt==='string');
  const db=manifest.databaseConfig,id=manifest.identityConfig;
  keys(db,'database,host,reservation,sendRecordRead,senderRecord');
  need(db.host==='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech'
   &&typeof db.database==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(db.database));
  for(const role of [db.reservation,db.senderRecord,db.sendRecordRead]){
   keys(role,'password,user');need(typeof role.user==='string'&&/^[a-z][a-z0-9_]{2,62}$/.test(role.user)
    &&!/admin|owner|superuser|postgres|root/.test(role.user)&&!role.user.startsWith('pg_')
    &&typeof role.password==='string'&&role.password.length>0&&role.password.length<=4096&&!/[\x00\r\n]/.test(role.password));
  }
  need(new Set([db.reservation.user,db.senderRecord.user,db.sendRecordRead.user]).size===3
   &&new Set([db.reservation.password,db.senderRecord.password,db.sendRecordRead.password]).size===3);
  keys(id,'audience,endpointPin,requestToken,requestUrl');
  need(id.audience==='meridian-negative-publisher'&&typeof id.requestToken==='string'&&id.requestToken.length>0
   &&id.requestUrl===id.endpointPin);
  const endpoint=new URL(id.requestUrl);need(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password
   &&!endpoint.hash&&!endpoint.searchParams.has('audience')&&endpoint.href===id.requestUrl);
  ({acquireToken,openPools,fetchFn,readCredential,clockMs=Date.now,
   monotonicMs=()=>performance.now(),deadlineMs=60000}=dependencies);
  for(const fn of [acquireToken,openPools,fetchFn,readCredential,clockMs,monotonicMs])need(typeof fn==='function');
  need(Number.isSafeInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=60000);
 }catch{throw Error('ACTIONS_BOOTSTRAP_CONFIGURATION_REJECTED');}
 let consumed=false;
 return async function run(parentSignal){
  if(consumed)return result('INPUT','ALREADY_CONSUMED');
  consumed=true;
  let stage='INPUT',timer,listener,pools,closed=false,lastWall,lastMono,startMono,stop;
  const controller=new AbortController();
  const stopped=new Promise((_,reject)=>{stop=()=>{controller.abort();reject(Error('STOPPED'));};});
  // Avoid an unhandled rejection if an abort arrives between awaited stages.
  stopped.catch(()=>{});
  const guard=()=>{
   need(!controller.signal.aborted&&!parentSignal?.aborted);
   const wall=clockMs(),mono=monotonicMs();
   need(Number.isSafeInteger(wall)&&wall>0&&Number.isFinite(mono));
   need(lastWall===undefined||wall>=lastWall);need(lastMono===undefined||mono>=lastMono);
   startMono??=mono;need(mono-startMono<deadlineMs);lastWall=wall;lastMono=mono;
   const now=Math.floor(wall/1000),c=manifest.trustedConfig;
   need(c.issuedAt<=now&&now<c.expiresAt);return now;
  };
  const bounded=async work=>{guard();const value=await Promise.race([
   Promise.resolve().then(()=>{guard();return work();}),stopped]);guard();return value;};
  const close=async value=>{
   if(!value||closed)return;closed=true;
   // The pool factory must handle partial-open cleanup; closure is idempotent.
   let timeout;try{await Promise.race([Promise.resolve().then(()=>value.close()),
    new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('CLEANUP_TIMEOUT')),5000);})]);}
   finally{clearTimeout(timeout);}
  };
  const safeFetch=(url,options={})=>bounded(()=>fetchFn(url,{...options,
   signal:options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal}));
  let answer;
  try{
   need(parentSignal===undefined||parentSignal instanceof AbortSignal);guard();
   listener=stop;parentSignal?.addEventListener('abort',listener,{once:true});
   timer=setTimeout(stop,deadlineMs);
   stage='PLAN';await bounded(()=>planForPublication(manifest.body,manifest.trustedConfig));
   stage='IDENTITY';const token=await bounded(()=>acquireToken(manifest.identityConfig,controller.signal));
   need(typeof token==='string'&&token.length>0&&token.length<=16384);
   const request=Object.freeze({body:manifest.body,token});
   stage='PREFLIGHT';const preflight=await bounded(()=>preflightPublication(request,manifest.trustedConfig,
    manifest.hostContext,{fetchFn:safeFetch,clock:guard}));
   need(preflight.kind==='PREFLIGHT_VALIDATED_NO_SEND');
   stage='POOLS';
   const opening=Promise.resolve().then(()=>{guard();return openPools(manifest.databaseConfig,controller.signal);})
    .then(async value=>{pools=value;if(controller.signal.aborted){await close(value);throw Error('STOPPED');}return value;});
   opening.catch(()=>{});
   pools=await bounded(()=>opening);
   need(typeof pools?.close==='function');
   for(const key of ['reservationPool','senderRecordPool','sendRecordReadPool'])need(typeof pools[key]?.query==='function');
   const p=JSON.parse(manifest.trustedConfig.pinsRaw),s=JSON.parse(manifest.trustedConfig.scopeRaw);
   const readEvidence=createGithubEvidenceReader({repositoryId:p.repositoryId,ownerId:manifest.trustedConfig.ownerId,
    approvalCommentId:p.ownerApprovalCommentId,prNumber:s.prNumber,ciRunId:s.ci.runId,publisherRunId:p.runId},{fetchFn:safeFetch});
   stage='HOST';const host=createPublicationHost({trustedConfig:manifest.trustedConfig,
    reservationPool:pools.reservationPool,senderRecordPool:pools.senderRecordPool,sendRecordReadPool:pools.sendRecordReadPool,
    readEvidence,oidcFetch:safeFetch,postFetch:safeFetch,commentFetch:safeFetch,
    readCredential:signal=>bounded(()=>readCredential(signal)),clockMs:()=>{guard();return lastWall;},monotonicMs,
    deadlineMs:Math.max(1,Math.floor(deadlineMs-(lastMono-startMono)))});
   const outcome=await bounded(()=>host(request,controller.signal));
   answer=result(outcome.stage,outcome.stage==='CONFIRMATION'&&outcome.outcome==='ACKNOWLEDGED'
    ?'OBSERVED_CONFIRMATION':'OWNER_RECONCILIATION_REQUIRED');
  }catch{answer=result(stage,stage==='INPUT'||stage==='PLAN'||stage==='IDENTITY'||stage==='PREFLIGHT'
   ?'REJECTED':'OWNER_RECONCILIATION_REQUIRED');}
  finally{
   clearTimeout(timer);if(parentSignal instanceof AbortSignal)parentSignal.removeEventListener('abort',listener);controller.abort();
   try{await close(pools);}catch{answer=result(stage,'OWNER_RECONCILIATION_REQUIRED');}
  }
  return answer;
 };
}
