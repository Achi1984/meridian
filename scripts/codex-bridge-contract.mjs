/**
 * Security R2: offline guards only. No authenticated transport or dispatch.
 * A GitHub-shaped object is data, NEVER authenticated evidence.
 */
import { createHash } from 'node:crypto';
export const PROTOCOL='MERIDIAN-CODEX-BRIDGE-V2';
export const REPOSITORY='Achi1984/meridian';
export const MODELS=Object.freeze(['gpt-5.3-codex']);
export const PATHS=Object.freeze([
  'scripts/codex-bridge-contract.mjs','scripts/codex-bridge-journal.mjs',
  'test/codex-bridge-contract.test.js','test/codex-bridge-journal.test.js',
  'docs/autonomy/CODEX_BRIDGE_V2_627.md',
]);
export const STATES=Object.freeze(['PLANNED','OWNER_AUTHORIZED','ASSIGNED','ACKED','DRAFT_PR',
  'CI_VERIFIED','CLAUDE_EXACT_HEAD_REVIEWED','AWAITING_MERGE_DECISION','STOPPED']);
const NEXT=Object.freeze({PLANNED:'OWNER_AUTHORIZED',OWNER_AUTHORIZED:'ASSIGNED',ASSIGNED:'ACKED',
  ACKED:'DRAFT_PR',DRAFT_PR:'CI_VERIFIED',CI_VERIFIED:'CLAUDE_EXACT_HEAD_REVIEWED',
  CLAUDE_EXACT_HEAD_REVIEWED:'AWAITING_MERGE_DECISION'});
const REQUEST_KEYS=['protocol','requestId','opId','expectedMain','expectedBase','expectedHead',
  'targetBranch','model','allowedPaths','allowedActions','researchStage','costGuard','forbidden'];
const plans=new WeakSet();
export class BridgeGuardError extends Error {
  constructor(code){super(code);this.name='BridgeGuardError';this.code=code;}
}
export function must(ok,code){if(!ok)throw new BridgeGuardError(code);}
export const isSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export const isHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function exactKeys(x,keys,code){
  must(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length
    &&keys.every(k=>Object.hasOwn(x,k)),code);
}
/** Strict canonical JSON: no getters, toJSON, coercion, cycles or sparse arrays. */
export function canonicalJson(input){
  const seen=new Set();
  const walk=(v,depth)=>{
    must(depth<=12,'JSON_DEPTH');
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='number'){must(Number.isSafeInteger(v),'JSON_NUMBER');return v;}
    if(typeof v==='string'){must(v.length<=65536&&v.isWellFormed(),'JSON_STRING');return v;}
    must(typeof v==='object'&&!seen.has(v),'JSON_TYPE');
    must(Object.getPrototypeOf(v)===(Array.isArray(v)?Array.prototype:Object.prototype),'JSON_TYPE');
    seen.add(v);
    const keys=Reflect.ownKeys(v);
    must(keys.length<=256&&keys.every(k=>typeof k==='string'),'JSON_KEYS');
    const read=k=>{
      const d=Object.getOwnPropertyDescriptor(v,k);
      must(d&&d.enumerable&&'value'in d,'JSON_ACCESSOR');return walk(d.value,depth+1);
    };
    let result;
    if(Array.isArray(v)){
      must(keys.length===v.length+1&&keys.every(k=>k==='length'||/^(0|[1-9][0-9]*)$/.test(k)),'JSON_ARRAY');
      result=Array.from({length:v.length},(_,i)=>read(String(i)));
    }else{
      must(!keys.some(k=>['__proto__','constructor','prototype'].includes(k)),'JSON_KEYS');
      result=Object.fromEntries(keys.sort().map(k=>[k,read(k)]));
    }
    seen.delete(v);return result;
  };
  const result=JSON.stringify(walk(input,0));
  must(Buffer.byteLength(result)<=65536,'JSON_SIZE');return result;
}
export const digest=x=>createHash('sha256').update(canonicalJson(x)).digest('hex');
export function bodyHash(body){
  must(typeof body==='string'&&body.isWellFormed()&&Buffer.byteLength(body)<=65536,'COMMENT_BODY_INVALID');
  return createHash('sha256').update(body,'utf8').digest('hex');
}
export function freeze(v){
  if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;
}
export const data=x=>JSON.parse(canonicalJson(x));
export function validateRequest(input){
  const r=data(input);exactKeys(r,REQUEST_KEYS,'REQUEST_SCHEMA');
  must(r.protocol===PROTOCOL,'PROTOCOL_MISMATCH');
  must(typeof r.requestId==='string'&&/^[A-Z0-9][A-Z0-9_-]{5,127}$/.test(r.requestId)
    &&typeof r.opId==='string'&&/^[A-Z0-9][A-Z0-9_-]{5,127}$/.test(r.opId),'REQUEST_ID_INVALID');
  must([r.expectedHead,r.expectedBase,r.expectedMain].every(isSha),'REQUEST_SHA_INVALID');
  must(r.expectedMain===r.expectedBase,'UNEXPECTED_BASE');
  // expectedHead means the immutable pre-work commit, not the eventual result.
  must(typeof r.targetBranch==='string'&&/^fix\/codex-bridge-v2-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.targetBranch)
    &&r.targetBranch.length<=120,'BRANCH_NOT_ISOLATED');
  must(MODELS.includes(r.model),'MODEL_NOT_ALLOWED');
  must(Array.isArray(r.allowedPaths)&&r.allowedPaths.length>0&&r.allowedPaths.length<=PATHS.length,'PATH_SCOPE_MISSING');
  must(r.allowedPaths.every(p=>typeof p==='string'&&PATHS.includes(p)),'PATH_SCOPE_INVALID');
  must(new Set(r.allowedPaths).size===r.allowedPaths.length,'PATH_DUPLICATE');
  must(r.researchStage==='SOURCE_AUDIT','RESEARCH_STAGE_FORBIDDEN');
  must(Array.isArray(r.allowedActions)&&canonicalJson(r.allowedActions)==='["offline_code","draft_pr"]','ACTIONS_FORBIDDEN');
  exactKeys(r.costGuard,['overageAllowed','additionalSpendAllowed'],'COST_GUARD_MISSING');
  must(r.costGuard.overageAllowed===false&&r.costGuard.additionalSpendAllowed===false,'COST_GUARD_MISSING');
  must(Array.isArray(r.forbidden)&&canonicalJson(r.forbidden)==='["merge","workflow","trading"]','FORBIDDEN_ACTION_GAP');
  return freeze({request:r,fingerprint:digest(r),authorized:false});
}
/** Comparison only; the local journal supplies durable dedup and CAS. */
export function reconcileRequest(prior,incoming){
  const a=validateRequest(prior),b=validateRequest(incoming);
  if(a.request.requestId===b.request.requestId){
    must(a.fingerprint===b.fingerprint,'DUPLICATE_SCOPE_CONFLICT');
    return freeze({status:'IDENTICAL_REPLAY_NO_ACTION',fingerprint:b.fingerprint,authorized:false});
  }
  must(a.request.opId!==b.request.opId,'OP_ID_REUSED');
  return freeze({status:'NEW_OFFLINE_REQUEST',fingerprint:b.fingerprint,authorized:false});
}
/** Legacy Boolean-based APIs deliberately closed: there is no trusted receipt issuer. */
export function validateAck(request){
  validateRequest(request);throw new BridgeGuardError('AUTHENTICATED_TRANSPORT_UNAVAILABLE');
}
export function validateDraftPr(request){
  validateRequest(request);throw new BridgeGuardError('AUTHENTICATED_TRANSPORT_UNAVAILABLE');
}
/** Structural diagnostics, NOT a verifier; pins and metadata are untrusted offline data. */
export function inspectCommentBinding(request,input,expected){
  const r=validateRequest(request).request,c=data(input),e=data(expected);
  exactKeys(c,['repository','issue','id','actorId','url','body','headSha','baseSha','requestId','opId'],'COMMENT_SCHEMA');
  exactKeys(e,['actorId','commentId','bodyHash'],'COMMENT_PIN_SCHEMA');
  must(Number.isSafeInteger(c.id)&&c.id>0&&Number.isSafeInteger(c.actorId)&&c.actorId>0,'COMMENT_ID_INVALID');
  must(c.repository===REPOSITORY&&c.issue===627
    &&c.url==='https://github.com/'+REPOSITORY+'/issues/627#issuecomment-'+c.id,'COMMENT_SOURCE_MISMATCH');
  must(c.actorId===e.actorId&&c.id===e.commentId&&bodyHash(c.body)===e.bodyHash,'COMMENT_PIN_MISMATCH');
  must(c.requestId===r.requestId&&c.opId===r.opId&&c.headSha===r.expectedHead&&c.baseSha===r.expectedBase,'COMMENT_SCOPE_MISMATCH');
  return freeze({classification:'STRUCTURALLY_BOUND_UNAUTHENTICATED',actorId:c.actorId,
    commentId:c.id,bodyHash:bodyHash(c.body),headSha:c.headSha,baseSha:c.baseSha,authorized:false});
}
/** Filename lists alone do not prove regular-file modes or rename scope. */
export function inspectDraftSnapshot(request,input,expectedResultHead){
  const r=validateRequest(request).request,p=data(input);
  exactKeys(p,['repository','number','draft','state','merged','headRef','headSha','baseSha','liveMain','files'],'PR_SCHEMA');
  must(isSha(expectedResultHead),'RESULT_HEAD_INVALID');
  must(p.repository===REPOSITORY&&Number.isSafeInteger(p.number)&&p.number>0,'PR_SOURCE_MISMATCH');
  must(p.state==='open'&&p.draft===true&&p.merged===false,'PR_NOT_DRAFT');
  must(p.baseSha===r.expectedBase&&p.liveMain===r.expectedMain,'PR_BASE_CHANGED');
  must(p.headRef===r.targetBranch&&p.headSha===expectedResultHead&&isSha(p.headSha),'PR_HEAD_MISMATCH');
  must(Array.isArray(p.files)&&p.files.length>0&&p.files.length<=r.allowedPaths.length,'PR_SCOPE_DRIFT');
  const paths=new Set();
  for(const f of p.files){
    exactKeys(f,['path','oldPath','status','oldMode','newMode'],'PR_FILE_SCHEMA');
    must(r.allowedPaths.includes(f.path)&&!paths.has(f.path),'PR_SCOPE_DRIFT');paths.add(f.path);
    must(f.oldPath===null&&['added','modified'].includes(f.status),'PR_CHANGE_FORBIDDEN');
    must(f.newMode==='100644'&&f.oldMode===(f.status==='added'?null:'100644'),'PR_MODE_FORBIDDEN');
  }
  return freeze({classification:'STRUCTURALLY_SCOPED_UNAUTHENTICATED',headSha:p.headSha,authorized:false});
}
export function createPlan(request){
  const r=validateRequest(request);
  const p=freeze({state:'PLANNED',request:r.request,fingerprint:r.fingerprint,headSha:r.request.expectedHead,
    revision:0,historyHash:digest({fingerprint:r.fingerprint,state:'PLANNED'}),authorized:false});
  plans.add(p);return p;
}
export function advance(ledger,input){
  must(plans.has(ledger),'LEDGER_UNTRUSTED');
  const e=data(input),r=ledger.request;
  must(ledger.state!=='STOPPED','TRANSITION_FORBIDDEN');
  must(STATES.includes(e.next),'EVENT_INVALID');
  must(e.requestId===r.requestId&&e.opId===r.opId&&e.expectedHead===ledger.headSha
    &&e.expectedBase===r.expectedBase&&e.expectedRevision===ledger.revision,'EVENT_SCOPE_MISMATCH');
  if(e.next==='STOPPED'){
    exactKeys(e,['next','requestId','opId','expectedHead','expectedBase','expectedRevision','reason'],'STOP_SCHEMA');
    must(['OWNER_ABORT','HEAD_MOVED','COST_UNVERIFIED','REVIEW_REVOKED','REVIEW_CONFLICT','UNKNOWN_OUTCOME'].includes(e.reason),'STOP_REASON_INVALID');
    const p=freeze({...ledger,state:'STOPPED',revision:ledger.revision+1,reason:e.reason,
      historyHash:digest({previous:ledger.historyHash,event:e})});plans.add(p);return p;
  }
  must(NEXT[ledger.state]===e.next,'TRANSITION_FORBIDDEN');
  throw new BridgeGuardError('AUTHENTICATED_TRANSPORT_UNAVAILABLE');
}
export function activationStatus(){
  return freeze({status:'DESIGNED_NOT_ACTIVATED',authorized:false,blockedBy:[
    'AUTHENTICATED_TRANSPORT_UNAVAILABLE','PINNED_ACTOR_POLICY_UNAPPROVED',
    'DURABLE_EXTERNAL_AUTHORITY_UNAVAILABLE','BILLING_QUOTA_RESERVATION_UNAVAILABLE',
    'INDEPENDENT_EXACT_HEAD_REVIEW_REQUIRED','BOUNDED_PILOT_OWNER_APPROVAL_REQUIRED',
  ]});
}
/** Conservative offline classifier; even GREEN cannot authorize a transition. */
export function inspectReviewSet(request,input,resultHead){
  const r=validateRequest(request).request,reviews=data(input);
  must(isSha(resultHead)&&Array.isArray(reviews)&&reviews.length>0&&reviews.length<=64,'REVIEW_SCHEMA');
  const ids=new Set();
  for(const v of reviews){
    exactKeys(v,['commentId','actorId','requestId','opId','headSha','baseSha','bodyHash','verdict','revoked'],'REVIEW_SCHEMA');
    must(Number.isSafeInteger(v.commentId)&&v.commentId>0&&v.actorId===209825114&&isHash(v.bodyHash),'REVIEW_IDENTITY_INVALID');
    must(v.requestId===r.requestId&&v.opId===r.opId,'REVIEW_SCOPE_MISMATCH');
    if(ids.has(v.commentId))return freeze({status:'STOP_REVIEW_CONFLICT',authorized:false});ids.add(v.commentId);
    if(v.headSha!==resultHead||v.baseSha!==r.expectedBase)return freeze({status:'STOP_STALE_REVIEW',authorized:false});
    must(typeof v.revoked==='boolean'&&['GREEN_LIGHT','CHANGES_REQUIRED','NEEDS_MORE_EVIDENCE'].includes(v.verdict),'REVIEW_VERDICT_INVALID');
    if(v.revoked)return freeze({status:'STOP_REVIEW_REVOKED',authorized:false});
    if(v.verdict!=='GREEN_LIGHT')return freeze({status:'STOP_REVIEW_INSUFFICIENT',authorized:false});
  }
  return freeze({status:'UNAUTHENTICATED_REVIEW_NO_AUTHORIZATION',authorized:false});
}
