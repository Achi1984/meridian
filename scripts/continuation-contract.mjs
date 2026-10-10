/** Offline claims only. No IO, clock, credentials, queue, dispatcher or authority. */
import {createHash} from 'node:crypto';

export class ContractError extends Error {
  constructor(code) { super(code); this.name = 'ContractError'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new ContractError(code); };
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const id = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
function object(value, keys, code) {
  need(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype, code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(descriptors).length === keys.length && keys.every(k =>
    Object.hasOwn(descriptors,k) && Object.hasOwn(descriptors[k],'value') && descriptors[k].enumerable),code);
}
function array(value, maximum, code) {
  need(Array.isArray(value) && value.length <= maximum,code);
  // Reject sparse arrays, accessors and extra/symbol keys before reading elements.
  const ds = Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(ds).length === value.length + 1,code);
  for (let n=0;n<value.length;n++) need(ds[n] && Object.hasOwn(ds[n],'value'),code);
}
const path = x => typeof x === 'string' && x.length <= 160 &&
  /^(?:docs\/v11\/[A-Za-z0-9][A-Za-z0-9_-]*\.md|test\/v11-[a-z0-9][a-z0-9-]*\.test\.js)$/.test(x);

/** Input is a JSON-shaped object. No serialized JSON parsing or duplicate-key claim. */
export function validateManifest(input) {
  object(input,['schema','repository','baseSha','issuedAt','expiresAt','maxInvocations','ownerApprovalRef','packets'],'MANIFEST_SCHEMA');
  need(input.schema===1 && input.repository==='Achi1984/meridian' && sha(input.baseSha),'MANIFEST_IDENTITY');
  need(integer(input.issuedAt) && integer(input.expiresAt) && input.expiresAt>input.issuedAt
    && input.expiresAt-input.issuedAt<=86400,'MANIFEST_WINDOW');
  need(typeof input.ownerApprovalRef==='string' && /^https:\/\/github\.com\/Achi1984\/meridian\/issues\/571#issuecomment-[1-9][0-9]{0,19}$/.test(input.ownerApprovalRef),'APPROVAL_REFERENCE');
  array(input.packets,8,'PACKETS');
  need(input.packets.length>0 && Number.isSafeInteger(input.maxInvocations)
    && input.maxInvocations>0 && input.maxInvocations<=input.packets.length,'INVOCATION_CAP');
  const seen = new Set(), paths = new Set();
  const packets = input.packets.map(p => {
    object(p,['id','paths','dependencies','dependencyGate','outputClass','templateDigest'],'PACKET_SCHEMA');
    need(id(p.id) && !seen.has(p.id),'PACKET_ID');
    array(p.paths,2,'PACKET_PATHS');
    need(p.paths.length===2 && p.paths.every(path) && p.paths[0].startsWith('docs/v11/')
      && p.paths[1].startsWith('test/v11-'),'PACKET_PATHS');
    need(p.paths.every(x=>!paths.has(x)),'DUPLICATE_PATH');
    p.paths.forEach(x=>paths.add(x));
    array(p.dependencies,7,'DEPENDENCIES');
    need(p.dependencies.every(d=>id(d)&&seen.has(d)) && new Set(p.dependencies).size===p.dependencies.length,'DEPENDENCIES');
    need(['draft','merged'].includes(p.dependencyGate) && p.outputClass==='docs-with-trusted-test'
      && digest(p.templateDigest),'OUTPUT_CONTRACT');
    seen.add(p.id);
    return {id:p.id,paths:[...p.paths],dependencies:[...p.dependencies],dependencyGate:p.dependencyGate,
      outputClass:p.outputClass,templateDigest:p.templateDigest};
  });
  return freeze({schema:1,repository:input.repository,baseSha:input.baseSha,issuedAt:input.issuedAt,
    expiresAt:input.expiresAt,maxInvocations:input.maxInvocations,ownerApprovalRef:input.ownerApprovalRef,packets});
}
const hash = m => createHash('sha256').update(JSON.stringify(m)).digest('hex');
const states = ['READY','CLAIMED','GENERATING','CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED','FAILED','UNKNOWN_OUTCOME'];
const busy = new Set(['CLAIMED','GENERATING','CI_WAIT','REVIEW_WAIT','MERGE_WAIT','UNKNOWN_OUTCOME']);
const empty = id => ({id,state:'READY',baseSha:null,headSha:null,ciHeadSha:null,reviewHeadSha:null,mergeSha:null});
function wrap(m,revision,revoked,packets) {
  return freeze({kind:'OFFLINE_CLAIMS_ONLY',manifestDigest:hash(m),revision,revoked,
    dispatchAllowed:false,mergeAllowed:false,authenticated:false,durable:false,packets});
}
export function initialLedger(manifest) {
  const m=validateManifest(manifest); return wrap(m,0,false,m.packets.map(p=>empty(p.id)));
}
function validateLedger(m,l) {
  object(l,['kind','manifestDigest','revision','revoked','dispatchAllowed','mergeAllowed','authenticated','durable','packets'],'LEDGER_SCHEMA');
  need(l.kind==='OFFLINE_CLAIMS_ONLY' && l.manifestDigest===hash(m) && integer(l.revision)
    && typeof l.revoked==='boolean' && l.dispatchAllowed===false && l.mergeAllowed===false
    && l.authenticated===false && l.durable===false,'LEDGER_IDENTITY');
  array(l.packets,8,'LEDGER_PACKETS');
  need(l.packets.length===m.packets.length,'LEDGER_PACKETS');
  let consumed=0;
  l.packets.forEach((p,i)=>{
    object(p,['id','state','baseSha','headSha','ciHeadSha','reviewHeadSha','mergeSha'],'LEDGER_PACKET');
    need(p.id===m.packets[i].id && states.includes(p.state),'LEDGER_PACKET');
    for (const key of ['baseSha','headSha','ciHeadSha','reviewHeadSha','mergeSha']) need(p[key]===null || sha(p[key]),'LEDGER_SHA');
    need(p.headSha===null || p.headSha!==m.baseSha,'HEAD_EQUALS_BASE');
    if(p.state==='READY') need(p.baseSha===null && p.headSha===null && p.ciHeadSha===null && p.reviewHeadSha===null && p.mergeSha===null,'READY_HAS_HISTORY');
    else { consumed++; need(p.baseSha===m.baseSha,'BASE_MISMATCH'); }
    if(['CLAIMED','GENERATING'].includes(p.state)) need(p.headSha===null && p.ciHeadSha===null && p.reviewHeadSha===null && p.mergeSha===null,'PRE_DRAFT_HISTORY');
    if(['CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(p.state)) need(sha(p.headSha),'MISSING_HEAD');
    if(p.state==='CI_WAIT') need(p.ciHeadSha===null && p.reviewHeadSha===null && p.mergeSha===null,'STALE_CI');
    if(['REVIEW_WAIT','COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(p.state)) need(p.ciHeadSha===p.headSha,'STALE_CI');
    if(p.state==='REVIEW_WAIT') need(p.reviewHeadSha===null && p.mergeSha===null,'STALE_REVIEW');
    if(['COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(p.state)) need(p.reviewHeadSha===p.headSha,'STALE_REVIEW');
    if(p.state==='COMPLETE_DRAFT') need(p.mergeSha===null,'UNVERIFIED_MERGE');
    if(['MERGE_WAIT','COMPLETE_MERGED'].includes(p.state)) need(sha(p.mergeSha),'MISSING_MERGE');
    if(!l.revoked && !['READY','FAILED','UNKNOWN_OUTCOME'].includes(p.state)) {
      need(m.packets[i].dependencies.every(d=>{
        const parent=l.packets.find(x=>x.id===d);
        return m.packets[i].dependencyGate==='merged'?parent?.state==='COMPLETE_MERGED':
          ['COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(parent?.state);
      }),'DEPENDENCY_INVALIDATED');
      need(l.packets.slice(0,i).every(x=>['COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(x.state)),'PACKET_ORDER');
    }
  });
  need(consumed<=m.maxInvocations,'INVOCATION_CAP');
  if(l.revoked) need(l.packets.every(p=>p.state==='READY' ||
    (['FAILED','UNKNOWN_OUTCOME'].includes(p.state) && p.ciHeadSha===null && p.reviewHeadSha===null)),'REVOKED_READINESS');
  else need(l.packets.filter(p=>busy.has(p.state)).length<=1,'MULTIPLE_WRITERS');
}

/** Pure simulation of claimed observations; never yields an executable command. */
export function advance(manifest,ledger,event,now) {
  const m=validateManifest(manifest); validateLedger(m,ledger);
  object(event,['type','packetId','expectedRevision','sha'],'EVENT_SCHEMA');
  need(Number.isSafeInteger(event.expectedRevision) && event.expectedRevision===ledger.revision,'STALE_REVISION');
  need(ledger.revision<Number.MAX_SAFE_INTEGER,'REVISION_LIMIT');
  need(integer(now),'CLOCK');
  need(id(event.packetId) && m.packets.some(p=>p.id===event.packetId),'UNKNOWN_PACKET');
  need(event.sha===null || sha(event.sha),'EVENT_SHA');
  const packets=ledger.packets.map(p=>({...p}));
  const p=packets.find(p=>p.id===event.packetId), spec=m.packets.find(p=>p.id===event.packetId);
  const revoke = () => {
    for(const item of packets) if(item.state!=='READY') {
      if(item.state!=='FAILED') item.state='UNKNOWN_OUTCOME';
      item.ciHeadSha=null;item.reviewHeadSha=null;
    }
    const out=wrap(m,ledger.revision+1,true,packets);validateLedger(m,out);return out;
  };
  if(event.type==='REVOKE') {
    need(event.sha===null,'UNEXPECTED_SHA'); return revoke();
  }
  need(!ledger.revoked,'REVOKED');
  need(now>=m.issuedAt && now<m.expiresAt,'EXPIRED_OR_NOT_STARTED');
  const match = () => need(event.sha===p.headSha && sha(event.sha),'HEAD_MISMATCH');
  switch(event.type) {
    case 'CLAIM':
      need(p.state==='READY','CLAIM_CONSUMED');
      need(!packets.some(x=>busy.has(x.state)),'WRITER_BUSY');
      need(packets.filter(x=>x.state!=='READY').length<m.maxInvocations,'INVOCATION_CAP');
      need(packets.slice(0,packets.indexOf(p)).every(x=>['COMPLETE_DRAFT','COMPLETE_MERGED'].includes(x.state)),'PACKET_ORDER');
      need(spec.dependencies.every(d=>{
        const x=packets.find(p=>p.id===d);
        return spec.dependencyGate==='merged'?x.state==='COMPLETE_MERGED':['COMPLETE_DRAFT','COMPLETE_MERGED'].includes(x.state);
      }),'DEPENDENCY_WAIT');
      // This prototype only accepts a fixed base, not automatic rebasing.
      need(event.sha===m.baseSha,'BASE_MISMATCH'); p.state='CLAIMED';p.baseSha=event.sha;break;
    case 'MODEL_STARTED':
      need(p.state==='CLAIMED' && event.sha===null,'INVALID_TRANSITION');p.state='GENERATING';break;
    case 'DRAFT_OBSERVED':
      need(p.state==='GENERATING' && sha(event.sha),'INVALID_TRANSITION');p.state='CI_WAIT';p.headSha=event.sha;break;
    case 'CI_PASSED':
      need(p.state==='CI_WAIT','INVALID_TRANSITION');match();p.state='REVIEW_WAIT';p.ciHeadSha=event.sha;break;
    case 'REVIEW_PASSED':
      need(p.state==='REVIEW_WAIT','INVALID_TRANSITION');match();p.state='COMPLETE_DRAFT';p.reviewHeadSha=event.sha;break;
    case 'HEAD_CHANGED':
      need(['CI_WAIT','REVIEW_WAIT','COMPLETE_DRAFT'].includes(p.state) && sha(event.sha) && event.sha!==p.headSha,'INVALID_TRANSITION');
      p.state='CI_WAIT';p.headSha=event.sha;p.ciHeadSha=null;p.reviewHeadSha=null;
      if(packets.some(x=>x.id!==p.id && x.state!=='READY')) return revoke();
      break;
    case 'REVIEW_REVOKED':
      need(['COMPLETE_DRAFT','MERGE_WAIT','COMPLETE_MERGED'].includes(p.state),'INVALID_TRANSITION');match();
      if(p.state!=='COMPLETE_DRAFT' || packets.some(x=>x.id!==p.id && x.state!=='READY')) return revoke();
      p.state='REVIEW_WAIT';p.reviewHeadSha=null;break;
    case 'MERGE_OBSERVED':
      need(p.state==='COMPLETE_DRAFT' && sha(event.sha),'INVALID_TRANSITION');p.state='MERGE_WAIT';p.mergeSha=event.sha;break;
    case 'POST_MERGE_PASSED':
      need(p.state==='MERGE_WAIT' && event.sha===p.mergeSha,'MERGE_MISMATCH');p.state='COMPLETE_MERGED';break;
    case 'FAIL': case 'OUTCOME_UNKNOWN':
      need(busy.has(p.state) && p.state!=='UNKNOWN_OUTCOME' && event.sha===null,'INVALID_TRANSITION');
      p.state=event.type==='FAIL'?'FAILED':'UNKNOWN_OUTCOME';break;
    default: throw new ContractError('UNKNOWN_EVENT');
  }
  const out=wrap(m,ledger.revision+1,false,packets); validateLedger(m,out);return out;
}
