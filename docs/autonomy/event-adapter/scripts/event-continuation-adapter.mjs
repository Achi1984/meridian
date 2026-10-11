/** Source-only interface composition. Supplied evidence is NEVER authenticated. */
import {types} from 'node:util';
import {normalizeEvent} from '../fixtures/scripts/event-continuation-intake.mjs';
import {planWork} from '../fixtures/scripts/development-centre-planner.mjs';
import {validateManifest,advance} from '../fixtures/scripts/continuation-contract.mjs';
export class AdapterError extends Error {constructor(code){super(code);this.name='AdapterError';this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new AdapterError(code);};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function copy(x,depth=0,budget={n:24000},seen=new Set()){
 need(--budget.n>=0&&depth<=16,'INPUT_LIMIT');
 if(x===null||typeof x==='boolean')return x;
 if(typeof x==='string'){need(x.length<=65536,'INPUT_LIMIT');return x;}
 if(typeof x==='number'){need(integer(x),'INVALID_NUMBER');return x;}
 need(x&&typeof x==='object'&&!types.isProxy(x)&&!seen.has(x),'INVALID_OBJECT');
 const arr=Array.isArray(x);need(Object.getPrototypeOf(x)===(arr?Array.prototype:Object.prototype),'INVALID_OBJECT');
 const ds=Object.getOwnPropertyDescriptors(x),keys=Reflect.ownKeys(ds);need(keys.length<=4097,'INPUT_LIMIT');
 if(arr)need(keys.length===x.length+1&&x.length<=4096,'INVALID_ARRAY');
 seen.add(x);const out=arr?[]:{};
 for(const k of keys){if(arr&&k==='length')continue;
  need(typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k),'INVALID_KEY');
  const d=ds[k];need(Object.hasOwn(d,'value')&&d.enumerable,'INVALID_DESCRIPTOR');
  if(arr)need(/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<x.length,'INVALID_ARRAY');
  out[k]=copy(d.value,depth+1,budget,seen);
 }
 seen.delete(x);return out;
}
function shape(x,keys){need(x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k)),'INVALID_SCHEMA');}
const scopeKeys=['repository','requestId','opId','headSha','baseSha'];
/** expected pins and snapshot MUST be obtained separately by the future trusted caller.
 * Neither input is authenticated here; this function performs no I/O or authorization.
 */
export function reconcileContinuation(input){
 const x=copy(input);shape(x,['trigger','config','expected','snapshot','manifest','ledger','requiredJobs']);
 const e=x.expected,s=x.snapshot;
 shape(e,['repository','packetId','requestId','opId','headSha','baseSha','mainSha','now','maxAgeSeconds','ci','reviewVersion']);
 if(e.ci!==null)shape(e.ci,['runId','runAttempt','workflowId','headSha']);
 shape(s,['repository','observedAt','mainSha','pr','work','eventBinding','ciBinding','reviewBinding']);
 if(s.ciBinding!==null)shape(s.ciBinding,['runId','runAttempt','workflowId','headSha']);
 shape(s.pr,['headSha','baseSha','state','mergeSha']);shape(s.eventBinding,['eventIdentity','revisionDigest']);
 shape(x.trigger,['name','payloadJson']);
 need(e.repository==='Achi1984/meridian'&&s.repository===e.repository,'REPOSITORY_MISMATCH');
 need([e.headSha,e.baseSha,e.mainSha,s.mainSha,s.pr.headSha,s.pr.baseSha].every(sha),'INVALID_SHA');
 need(integer(e.now)&&integer(s.observedAt)&&integer(e.maxAgeSeconds)&&e.maxAgeSeconds>0&&e.maxAgeSeconds<=300,'INVALID_TIME');
 need(s.observedAt<=e.now&&e.now-s.observedAt<=e.maxAgeSeconds,'STALE_SNAPSHOT');
 need(['open','merged','closed'].includes(s.pr.state),'INVALID_PR_STATE');
 need(s.pr.state==='merged'?sha(s.pr.mergeSha):s.pr.mergeSha===null,'INVALID_MERGE_SHA');
 const event=normalizeEvent(x.trigger.name,x.trigger.payloadJson,JSON.stringify(x.config));
 need(event.repository===e.repository,'REPOSITORY_MISMATCH');
 const m=validateManifest(x.manifest);need(m.repository===e.repository,'REPOSITORY_MISMATCH');
 const spec=m.packets.find(p=>p.id===e.packetId);need(spec,'PACKET_MISMATCH');
 // Reuse the reducer's existing complete ledger validator via a discarded pure
 // REVOKE dry run. No input is mutated; the computed revoked ledger is never returned.
 // This avoids a second ledger state machine or weakened duplicate schema.
 advance(m,x.ledger,{type:'REVOKE',packetId:e.packetId,sha:null,expectedRevision:x.ledger.revision},e.now);
 const packet=x.ledger.packets.find(p=>p.id===e.packetId);
 const results=planWork({requiredJobs:x.requiredJobs,work:[s.work]});const plan=results[0];
 need(scopeKeys.every(k=>s.work[k]===e[k]),'EXPECTED_WORK_SCOPE_MISMATCH');
 need(s.pr.headSha===e.headSha&&s.pr.baseSha===e.baseSha,'EXPECTED_PR_SCOPE_MISMATCH');
 need(spec.paths.length===s.work.paths.length&&spec.paths.every(p=>s.work.paths.includes(p)),'PACKET_PATH_MISMATCH');
 need(packet.headSha===null||packet.headSha===e.headSha,'LEDGER_HEAD_MISMATCH');
 const result=(decision,reason,ledger=x.ledger)=>freeze({kind:'OFFLINE_CONTINUATION_DECISION',decision,reason,
  eventIdentity:event.eventIdentity,revisionDigest:event.revisionDigest,ledger,planner:plan,
  authenticated:false,provenanceVerified:false,authorized:false,dispatchAllowed:false,mergeAllowed:false,durable:false});
 const stop=(decision,reason)=>result(decision,reason,packet.state==='COMPLETE_DRAFT'&&!x.ledger.revoked
  ?advance(m,x.ledger,{type:'REVOKE',packetId:e.packetId,sha:null,expectedRevision:x.ledger.revision},e.now):x.ledger);
 if(x.ledger.revoked||['FAILED','UNKNOWN_OUTCOME'].includes(packet.state)||s.work.execution==='UNKNOWN')return stop('BLOCKED','RECONCILE_UNKNOWN_OR_FAILED');
 if(s.mainSha!==m.baseSha||s.mainSha!==e.mainSha||s.pr.baseSha!==m.baseSha||s.pr.state==='merged'||['MERGE_WAIT','COMPLETE_MERGED'].includes(packet.state))return stop('RECONCILE_NEW_MANIFEST','MAIN_OR_BASE_MOVED');
 if(s.pr.state==='closed')return stop('BLOCKED','PR_CLOSED');
 if(e.now<m.issuedAt||e.now>=m.expiresAt)return stop('BLOCKED','MANIFEST_EXPIRED_OR_NOT_STARTED');
 if(s.eventBinding.eventIdentity!==event.eventIdentity||s.eventBinding.revisionDigest!==event.revisionDigest)return stop('RECONCILE_EVENT','EVENT_SNAPSHOT_MISMATCH');
 if(event.eventName==='workflow_run'){
  const c=event.claims;
  if(!s.work.ci||!s.ciBinding||['runId','runAttempt','workflowId','headSha'].some(k=>c[k]!==s.ciBinding[k])||c.runId!==s.work.ci.runId||c.headSha!==e.headSha)return stop('RECONCILE_EVENT','CI_EVENT_SCOPE_MISMATCH');
  if(c.conclusion!=='success')return stop('BLOCKED','NON_SUCCESS_TRIGGER');
 }else if(event.claims.action==='deleted')return stop('BLOCKED','REVIEW_EVENT_DELETED');
 else if(!s.work.responses.some(r=>r.reviewCommentId===event.claims.commentId))return stop('RECONCILE_EVENT','REVIEW_EVENT_NOT_IN_SNAPSHOT');
 if(plan.status==='BLOCKED')return stop('BLOCKED',plan.reason);
 // Both workflow and mailbox paths consume CI. Bind independently pinned exact
 // attempt/workflow/head before any CI_PASSED, REVIEW_PASSED or retained readiness.
 // Adverse evidence above retains precedence and invalidates completed readiness.
 if(s.work.ci!==null){
  const identity=['runId','runAttempt','workflowId','headSha'];
  const valid=v=>v&&['runId','runAttempt','workflowId'].every(k=>integer(v[k])&&v[k]>0)&&sha(v.headSha);
  if(!valid(e.ci)||!valid(s.ciBinding)||identity.some(k=>e.ci[k]!==s.ciBinding[k])
    ||e.ci.runId!==s.work.ci.runId||e.ci.headSha!==e.headSha||e.ci.headSha!==s.work.ci.headSha
    ||!x.config.workflowIds.includes(e.ci.workflowId))return stop('RECONCILE_EVENT','CI_BINDING_INVALID');
 }

 if(plan.status==='WAITING_AGENT')return stop('WAITING_AGENT',plan.reason);
 if(plan.status==='WAITING_CI')return stop('WAITING_CI',plan.reason);
 // A planner response discards the claim's version and CI pins. Reattach only
 // separately validated binder evidence, then compare independent current pins.
 // These caller-supplied objects are still not authenticated by this adapter.
 if(plan.status==='READY_FOR_OWNER_DECISION'){
  const versionKeys=['commentId','createdAt','updatedAt','bodySha256'];
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v.replace('Z','.000Z');
  const validVersion=v=>v&&integer(v.commentId)&&v.commentId>0&&timestamp(v.createdAt)&&timestamp(v.updatedAt)&&v.updatedAt>=v.createdAt&&typeof v.bodySha256==='string'&&/^[a-f0-9]{64}$/.test(v.bodySha256);
  const r=s.reviewBinding,v=e.reviewVersion,ciKeys=['runId','runAttempt','workflowId','headSha'];
  const scoped=s.work.responses.filter(row=>scopeKeys.every(k=>row[k]===e[k]));
  if(!exact(r,[...versionKeys,'ci'])||!exact(v,versionKeys)||!validVersion(r)||!validVersion(v)
    ||versionKeys.some(k=>r[k]!==v[k])||!exact(r.ci,ciKeys)||!e.ci||ciKeys.some(k=>r.ci[k]!==e.ci[k])
    ||scoped.length!==1||scoped[0].reviewCommentId!==r.commentId||scoped[0].verdict!=='GREEN_LIGHT')return stop('RECONCILE_EVENT','REVIEW_BINDING_INVALID');
  if(event.eventName==='issue_comment'&&(event.claims.commentId!==r.commentId||event.claims.createdAt!==r.createdAt
    ||event.claims.updatedAt!==r.updatedAt||event.claims.bodyDigest!==r.bodySha256))return stop('RECONCILE_EVENT','REVIEW_EVENT_VERSION_MISMATCH');
 }
 let ledger=x.ledger;
 const move=(type)=>{ledger=advance(m,ledger,{type,packetId:e.packetId,sha:e.headSha,expectedRevision:ledger.revision},e.now);};
 if(packet.state==='CI_WAIT')move('CI_PASSED');
 if(!['CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT'].includes(packet.state))return result('WAITING_DRAFT','POST_DRAFT_ADAPTER_ONLY');
 if(plan.status==='WAITING_REVIEW'){
  // A disappeared review cannot leave a completed draft available for reuse.
  if(packet.state==='COMPLETE_DRAFT')move('REVIEW_REVOKED');
  return result('WAITING_REVIEW',plan.reason,ledger);
 }
 if(ledger.packets.find(p=>p.id===e.packetId).state==='REVIEW_WAIT')move('REVIEW_PASSED');
 return result('READY_FOR_OWNER_DECISION','OFFLINE_CONSISTENT_ONLY',ledger);
}
