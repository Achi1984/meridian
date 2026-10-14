// Inactive deployment-wrapper source. No process.env, CLI, startup or implicit driver.
// The deployment must pass the actual runner context independently of its manifest.
import {createActionsPublicationIdentity} from './publication-actions-identity.mjs';
import {openPublicationPools} from './publication-actions-pools.mjs';
import {createActionsPublicationBootstrap} from './publication-actions-bootstrap.mjs';
import {planForPublication} from './publication-plan-process.mjs';
const HOST='ep-purple-dew-b9mbuikp.c-7.eu-central-1.aws.neon.tech';
const flags={authenticated:false,authorized:false,provenanceVerified:false,durable:false,
 dispatchAllowed:false,mergeAllowed:false,sendAllowed:false};
const result=(stage,outcome)=>({kind:'INACTIVE_ACTIONS_TEST_RUNNER_RESULT',stage,outcome,...flags});
function need(ok){if(!ok)throw Error('TEST_RUNNER_REJECTED');}
function shape(value,names){need(value&&typeof value==='object'&&!Array.isArray(value)
 &&[Object.prototype,null].includes(Object.getPrototypeOf(value))
 &&Reflect.ownKeys(value).every(k=>typeof k==='string')&&Object.keys(value).sort().join()===names);
 for(const d of Object.values(Object.getOwnPropertyDescriptors(value)))need(Object.hasOwn(d,'value')&&d.enumerable);
}
function snapshot(value){
 const seen=new WeakSet();let nodes=0,bytes=0;
 function copy(v,depth){
  need(++nodes<=4096&&depth<=32);
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v);need(bytes<=131072);return v;}
  if(typeof v==='number'){need(Number.isFinite(v));return v;}
  need(v&&typeof v==='object'&&!seen.has(v));seen.add(v);
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  need(array?proto===Array.prototype:proto===Object.prototype||proto===null);
  const descriptors=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(descriptors);
  need(names.every(k=>typeof k==='string'));
  const out=array?[]:Object.create(null);
  if(array)need(names.length===v.length+1);
  for(const k of names){
   if(array&&k==='length')continue;
   const d=descriptors[k];need(Object.hasOwn(d,'value')&&d.enumerable);
   if(array)need(/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length);
   bytes+=Buffer.byteLength(k);need(bytes<=131072);
   Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:false,configurable:false});
  }
  seen.delete(v);return Object.freeze(out);
 }
 return copy(value,0);
}
function decimal(value){need(typeof value==='string'&&/^[1-9][0-9]{0,15}$/.test(value));
 const n=Number(value);need(Number.isSafeInteger(n));return n;}
export function createPublicationTestRunner(options){
 let context,identityConfig,acquireToken,Pool,fetchFn,readApprovedManifest,readRoleCredentials,
  readPublisherCredential,clockMs,monotonicMs,deadlineMs,databaseName;
 try{
  shape(options,'Pool,clockMs,databaseName,deadlineMs,fetchFn,monotonicMs,readApprovedManifest,readPublisherCredential,readRoleCredentials,runnerEnv');
  ({Pool,fetchFn,readApprovedManifest,readRoleCredentials,readPublisherCredential,
    clockMs,monotonicMs,deadlineMs,databaseName}=options);
  need(typeof databaseName==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(databaseName));
  for(const fn of [Pool,fetchFn,readApprovedManifest,readRoleCredentials,readPublisherCredential,clockMs,monotonicMs])need(typeof fn==='function');
  need(Number.isSafeInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=60000);
  const env=snapshot(options.runnerEnv);
  shape(env,'ACTIONS_ID_TOKEN_REQUEST_TOKEN,ACTIONS_ID_TOKEN_REQUEST_URL,GITHUB_ACTIONS,GITHUB_ACTOR_ID,GITHUB_EVENT_NAME,GITHUB_REF,GITHUB_REPOSITORY,GITHUB_RUN_ATTEMPT,GITHUB_RUN_ID,GITHUB_SHA,RUNNER_ENVIRONMENT');
  need(env.GITHUB_ACTIONS==='true'&&env.RUNNER_ENVIRONMENT==='github-hosted'
   &&env.GITHUB_REPOSITORY==='Achi1984/meridian'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'
   &&env.GITHUB_REF==='refs/heads/main'&&env.GITHUB_RUN_ATTEMPT==='1');
  const actorId=decimal(env.GITHUB_ACTOR_ID),runId=decimal(env.GITHUB_RUN_ID);
  need(actorId===319562141&&typeof env.GITHUB_SHA==='string'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA));
  const runnerUrl=env.ACTIONS_ID_TOKEN_REQUEST_URL,url=new URL(runnerUrl);
  need(typeof runnerUrl==='string'&&runnerUrl.length<=8192&&url.href===runnerUrl
   &&url.protocol==='https:'&&url.port===''&&!url.username&&!url.password&&!runnerUrl.includes('#')
   &&url.hostname.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+actions\.githubusercontent\.com$/.test(url.hostname)
   &&!url.searchParams.has('audience'));
  need(typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN==='string'&&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>0
   &&env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length<=16384&&/^[\x21-\x7e]+$/.test(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN));
  // This captured URL is independent of all manifest/role callbacks below.
  acquireToken=createActionsPublicationIdentity({runnerUrl,fetchFn});
  identityConfig=Object.freeze({requestUrl:runnerUrl,endpointPin:runnerUrl,
   requestToken:env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,audience:'meridian-negative-publisher'});
  context=Object.freeze({repository:env.GITHUB_REPOSITORY,actorId,event:env.GITHUB_EVENT_NAME,
   ref:env.GITHUB_REF,runAttempt:1,runId,sha:env.GITHUB_SHA});
 }catch{throw Error('TEST_RUNNER_CONFIGURATION_REJECTED');}
 let consumed=false;
 return async function run(parentSignal){
  if(consumed)return result('INPUT','ALREADY_CONSUMED');consumed=true;
  let stage='INPUT',timer,listener,stop,lastWall,lastMono,startMono,approved;
  const controller=new AbortController();
  const stopped=new Promise((_,reject)=>{stop=()=>{controller.abort();reject(Error('STOPPED'));};});stopped.catch(()=>{});
  const guard=()=>{
   need(!controller.signal.aborted&&!parentSignal?.aborted);
   const wall=clockMs(),mono=monotonicMs();
   need(Number.isSafeInteger(wall)&&wall>0&&Number.isFinite(mono));
   need(lastWall===undefined||wall>=lastWall);need(lastMono===undefined||mono>=lastMono);
   startMono??=mono;need(mono-startMono<deadlineMs);lastWall=wall;lastMono=mono;
   if(approved){const c=approved.trustedConfig,now=Math.floor(wall/1000);need(c.issuedAt<=now&&now<c.expiresAt);}
  };
  const bounded=async work=>{guard();const value=await Promise.race([
   Promise.resolve().then(()=>{guard();return work();}),stopped]);guard();return value;};
  try{
   need(parentSignal===undefined||parentSignal instanceof AbortSignal);guard();
   listener=stop;parentSignal?.addEventListener('abort',listener,{once:true});timer=setTimeout(stop,deadlineMs);
   stage='MANIFEST';approved=snapshot(await bounded(()=>readApprovedManifest(controller.signal)));
   shape(approved,'body,trustedConfig');
   const c=approved.trustedConfig;
   shape(c,'approvalUpdatedAt,environment,expiresAt,issuedAt,ownerId,pinsRaw,policyRaw,scopeRaw,subject');
   need(c.ownerId===context.actorId&&typeof c.environment==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(c.environment));
   need(typeof approved.body==='string'&&Buffer.byteLength(approved.body)>0&&Buffer.byteLength(approved.body)<=8192);
   need(Number.isSafeInteger(c.issuedAt)&&Number.isSafeInteger(c.expiresAt)&&c.expiresAt>c.issuedAt
    &&c.expiresAt-c.issuedAt<=900&&typeof c.approvalUpdatedAt==='string');
   const p=JSON.parse(c.pinsRaw);
   need(p.repositoryId===1342084551&&p.controlSha===context.sha&&p.runId===context.runId
    &&p.runAttempt===context.runAttempt&&p.event===context.event&&p.ref===context.ref);
   need(c.subject===`repo:Achi1984/meridian:environment:${c.environment}`
    ||c.subject===`repo:Achi1984@${c.ownerId}/meridian@${p.repositoryId}:environment:${c.environment}`);
   guard();stage='PLAN';await bounded(()=>planForPublication(approved.body,c));
   // Bootstrap needs explicit role credentials at construction. Read them only
   // after offline manifest/context checks, not claimed to be after token preflight.
   stage='ROLE_CREDENTIALS';const roles=snapshot(await bounded(()=>readRoleCredentials(controller.signal)));
   shape(roles,'reservation,sendRecordRead,senderRecord');
   for(const name of ['reservation','sendRecordRead','senderRecord'])shape(roles[name],'password,user');
   stage='BOOTSTRAP';guard();
   const execute=createActionsPublicationBootstrap({body:approved.body,trustedConfig:c,
    hostContext:context,identityConfig,databaseConfig:{host:HOST,database:databaseName,...roles}},
    {acquireToken,openPools:config=>openPublicationPools(config,{Pool}),fetchFn,
     readCredential:signal=>bounded(()=>readPublisherCredential(signal)),
     clockMs,monotonicMs,deadlineMs:Math.max(1,Math.floor(deadlineMs-(lastMono-startMono)))});
   // Bootstrap owns pool cleanup, including cancellation and late acquisition.
   const outcome=await execute(controller.signal);
   return result(outcome.stage,outcome.outcome);
  }catch{return result(stage,stage==='BOOTSTRAP'?'OWNER_RECONCILIATION_REQUIRED':'REJECTED');}
  finally{clearTimeout(timer);if(parentSignal instanceof AbortSignal)parentSignal.removeEventListener('abort',listener);controller.abort();}
 };
}
