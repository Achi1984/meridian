// Synthetic trusted memory only: no disk, network, dispatch or production key.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {createOfflineStore} from './autonomy-v2-offline-store.mjs';
import {isOfflineDataRecord as record,isOfflineDataArray as list} from './autonomy-v2-offline-data.mjs';

const DOMAIN='MERIDIAN/OFFLINE-TRANSACTION/V1\n';
const HEX=/^[0-9a-f]{64}$/;
const clone=value=>structuredClone(value);
const answer=(ok,reason,extra={})=>Object.freeze({ok,reason,...extra});
const exact=(value,required,optional=[])=>record(value)&&required.every(key=>Object.hasOwn(value,key))&&
  Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const nonblank=value=>typeof value==='string'&&value.trim().length>0;
const counter=value=>Number.isSafeInteger(value)&&value>=0;
const OPERATION_KEYS=Object.freeze({
  CLAIM:['taskId','writer','revision','head','base','now','ttl','opId'],
  MARK_RECOVERY:['taskId','revision','fence','now','opId'],
  REQUEUE:['taskId','revision','fence','opId'],
  COMPLETE:['taskId','revision','fence','writer','opId']
});

// Validate descriptors before reading values. No getters, toJSON or custom iterators.
function canonical(value,ancestors=new Set()) {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0))return String(value);
  if(typeof value!=='object'||ancestors.has(value))throw Error('INVALID_SNAPSHOT');
  ancestors.add(value);
  let serialized;
  if(list(value))serialized='['+value.map(item=>canonical(item,ancestors)).join(',')+']';
  else if(record(value))serialized='{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],ancestors)).join(',')+'}';
  else throw Error('INVALID_SNAPSHOT');
  ancestors.delete(value);
  return serialized;
}

function watermarks(snapshot) {
  return snapshot.map(task=>({taskId:task.taskId,fence:task.operations.reduce((max,op)=>Math.max(max,op.fence),0)}));
}

/** A fixture authority. Its closure survives coordinator restart; it is not durable storage. */
export function createOfflineAuthority(initial=[],options={}) {
  if(!exact(options,[],['key','scope']))throw Error('INVALID_AUTHORITY_OPTIONS');
  const key=options.key??'meridian-offline-fixture-key-v1';
  const scope=options.scope??'meridian-offline-fixture';
  if(typeof key!=='string'||Buffer.byteLength(key,'utf8')<16||!nonblank(scope))throw Error('INVALID_AUTHORITY_OPTIONS');
  let current=createOfflineStore(initial).snapshotAll(),generation=0,epoch=0;
  let fences=watermarks(current),envelope;
  const stages=new WeakMap();
  function seal(snapshot,nextGeneration,nextEpoch,nextFences) {
    const payload={version:1,scope,generation:nextGeneration,epoch:nextEpoch,snapshot:clone(snapshot),fences:clone(nextFences)};
    const digest=createHash('sha256').update(DOMAIN+canonical(payload)).digest('hex');
    const mac=createHmac('sha256',key).update(DOMAIN+digest).digest('hex');
    return {...payload,digest,mac};
  }
  envelope=seal(current,generation,epoch,fences);
  const snapshot=()=>clone(envelope);
  const authorityState=()=>({generation,epoch,digest:envelope.digest,fences:clone(fences)});

  function restore(input) {
    try{
      if(!exact(input,['version','scope','generation','epoch','snapshot','fences','digest','mac'])||input.version!==1||
        !nonblank(input.scope)||!counter(input.generation)||!counter(input.epoch)||!list(input.snapshot)||!list(input.fences)||
        typeof input.digest!=='string'||!HEX.test(input.digest)||typeof input.mac!=='string'||!HEX.test(input.mac))return answer(false,'INVALID_SNAPSHOT');
      if(input.scope!==scope)return answer(false,'SNAPSHOT_SCOPE_MISMATCH');
      const payload={version:input.version,scope:input.scope,generation:input.generation,epoch:input.epoch,snapshot:input.snapshot,fences:input.fences};
      const digest=createHash('sha256').update(DOMAIN+canonical(payload)).digest('hex');
      const mac=createHmac('sha256',key).update(DOMAIN+digest).digest('hex');
      if(digest!==input.digest||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(input.mac,'hex')))return answer(false,'INVALID_SNAPSHOT_AUTH');
      if(input.generation!==generation||input.epoch!==epoch||input.digest!==envelope.digest)return answer(false,'SNAPSHOT_ROLLBACK');
      // Defense in depth: authentication never substitutes for the Phase 1B ledger schema.
      const verified=createOfflineStore(input.snapshot).snapshotAll();
      if(canonical(watermarks(verified))!==canonical(input.fences))return answer(false,'INVALID_SNAPSHOT');
      return answer(true,'SNAPSHOT_VERIFIED',{snapshot:verified,generation,epoch});
    }catch{return answer(false,'INVALID_SNAPSHOT');}
  }

  function restart() {
    if(!Number.isSafeInteger(epoch+1))return answer(false,'COUNTER_EXHAUSTED');
    const nextEnvelope=seal(current,generation,epoch+1,fences);
    epoch++;envelope=nextEnvelope;
    return answer(true,'RESTARTED',{generation,epoch});
  }

  function openWriter(writer) {
    if(!nonblank(writer))throw Error('INVALID_WRITER');
    const sessionEpoch=epoch,session={};
    const live=()=>sessionEpoch===epoch;
    function preflight(request) {
      if(!live())return answer(false,'STALE_WRITER');
      if(!exact(request,['type','args','expectedGeneration'])||typeof request.type!=='string')return answer(false,'INVALID_OPERATION');
      if(!Object.hasOwn(OPERATION_KEYS,request.type))return answer(false,'UNKNOWN_OPERATION');
      const optional=request.type==='COMPLETE'?['outcome']:[];
      if(!exact(request.args,OPERATION_KEYS[request.type],optional))return answer(false,'INVALID_OPERATION');
      // Arguments are scalars; prohibit nested objects/coercion before the existing store reads them.
      if(Object.values(request.args).some(value=>!['string','number'].includes(typeof value)))return answer(false,'INVALID_OPERATION');
      if(!counter(request.expectedGeneration))return answer(false,'INVALID_OPERATION');
      if(request.expectedGeneration!==generation)return answer(false,'STALE_GENERATION');
      if((request.type==='CLAIM'||request.type==='COMPLETE')&&request.args.writer!==writer)return answer(false,'STALE_WRITER');
      return null;
    }
    function stage(request) {
      const invalid=preflight(request);if(invalid)return invalid;
      if(!Number.isSafeInteger(generation+1))return answer(false,'COUNTER_EXHAUSTED');
      const operation=clone(request),store=createOfflineStore(current),task=store.snapshot(operation.args.taskId);
      if(operation.type==='CLAIM'&&task){
        const external=fences.find(item=>item.taskId===task.taskId)?.fence??0;
        if(task.nextFence<=external)return answer(false,'STALE_FENCE');
      }
      const method={CLAIM:'claim',MARK_RECOVERY:'markRecovery',REQUEUE:'reconcileToQueue',COMPLETE:'complete'}[operation.type];
      const result=store[method](operation.args);if(!result.ok)return result;
      const candidate=store.snapshotAll(),nextFences=watermarks(candidate);
      if(fences.some(previous=>(nextFences.find(item=>item.taskId===previous.taskId)?.fence??-1)<previous.fence))return answer(false,'STALE_FENCE');
      // Only a ticket can authorize a commit. The candidate never crosses the closure boundary.
      const ticket=Object.freeze({});
      stages.set(ticket,{session,sessionEpoch,expectedGeneration:generation,candidate,nextFences,result,used:false});
      return answer(true,'STAGED',{ticket});
    }
    function commit(ticket) {
      if(!live())return answer(false,'STALE_WRITER');
      if(ticket===null||typeof ticket!=='object')return answer(false,'INVALID_TICKET');
      const staged=stages.get(ticket);if(!staged||staged.session!==session)return answer(false,'INVALID_TICKET');
      if(staged.used)return answer(false,'TICKET_USED');
      if(staged.sessionEpoch!==epoch)return answer(false,'STALE_WRITER');
      if(staged.expectedGeneration!==generation)return answer(false,'STALE_GENERATION');
      const nextGeneration=generation+1;
      if(!Number.isSafeInteger(nextGeneration))return answer(false,'COUNTER_EXHAUSTED');
      const nextEnvelope=seal(staged.candidate,nextGeneration,epoch,staged.nextFences);
      // Synthetic atomic commit: every trusted field changes together, with no injected point inside.
      current=staged.candidate;fences=staged.nextFences;generation=nextGeneration;envelope=nextEnvelope;staged.used=true;
      return answer(true,staged.result.reason,{task:clone(staged.result.task),generation,epoch});
    }
    function checkFence(args) {
      if(!live())return answer(false,'STALE_WRITER');
      if(!exact(args,['taskId','fence'])||!nonblank(args.taskId)||!Number.isSafeInteger(args.fence)||args.fence<1)return answer(false,'INVALID_OPERATION');
      const task=current.find(item=>item.taskId===args.taskId);if(!task)return answer(false,'UNKNOWN_TASK');
      const external=fences.find(item=>item.taskId===args.taskId)?.fence??0;
      return task.state==='CLAIMED'&&task.writer===writer&&task.lease?.fence===args.fence&&external===args.fence?
        answer(true,'FENCE_ACCEPTED',{generation,epoch}):answer(false,'STALE_FENCE');
    }
    return Object.freeze({stage,commit,checkFence,preflight});
  }
  return Object.freeze({openWriter,snapshot,restore,authorityState,restart});
}
