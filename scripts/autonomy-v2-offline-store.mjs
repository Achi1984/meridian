// In-memory, deterministic Phase-1B laboratory only. No disk, network or dispatch.
import {planOfflineRecovery} from './autonomy-v2-offline-recovery.mjs';
import {isOfflineDataRecord as record,isOfflineDataArray as list} from './autonomy-v2-offline-data.mjs';
const SHA=/^[0-9a-f]{40}$/;
const STATES=new Set(['QUEUED','CLAIMED','RECOVERY_PENDING','COMPLETED','FAILED']);
const clone=value=>structuredClone(value);
const result=(ok,reason,task)=>Object.freeze({ok,reason,...(task?{task:clone(task)}:{})});
// Snapshots are plain data. Reject inherited fields, accessors and schema extensions.
const schema=(value,required,optional=[])=>record(value)&&required.every(key=>Object.hasOwn(value,key))&&
  Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=value=>typeof value==='string'&&value.trim().length>0;
function validateTask(input) {
  const invalid=()=>{throw Error('INVALID_RESTORED_TASK');};
  if(!schema(input,['taskId','state','revision','head','base','nextFence','budget','operations'],['lease','writer'])||
    !text(input.taskId)||!STATES.has(input.state)||
    !Number.isSafeInteger(input.revision)||input.revision<0||typeof input.head!=='string'||!SHA.test(input.head)||
    typeof input.base!=='string'||!SHA.test(input.base)||
    !Number.isSafeInteger(input.nextFence)||input.nextFence<1||!schema(input.budget,['limit','used'])||!Number.isSafeInteger(input.budget.limit)||
    input.budget.limit<1||!Number.isSafeInteger(input.budget.used)||input.budget.used<0||input.budget.used>input.budget.limit||
    !list(input.operations)) invalid();
  const ids=new Set();let charged=0,state='QUEUED',latestFence=0;
  for(const op of input.operations){
    if(!schema(op,['opId','kind','units','fence'])||!text(op.opId)||ids.has(op.opId)||
      !Number.isSafeInteger(op.fence)||op.fence<1) invalid();
    ids.add(op.opId);
    if(op.kind==='CLAIM'){
      // Only a new CLAIM advances the fence; follow-up operations retain that fence.
      if(state!=='QUEUED'||op.units!==1||op.fence<=latestFence) invalid();
      latestFence=op.fence;charged++;state='CLAIMED';
    }else{
      if(op.units!==0||op.fence!==latestFence) invalid();
      if(op.kind==='RECOVERY_MARK'&&state==='CLAIMED') state='RECOVERY_PENDING';
      else if(op.kind==='REQUEUE'&&state==='RECOVERY_PENDING') state='QUEUED';
      else if((op.kind==='COMPLETED'||op.kind==='FAILED')&&state==='CLAIMED') state=op.kind;
      else invalid();
    }
    if(!Number.isSafeInteger(charged)) invalid();
  }
  if(input.state!==state||input.revision!==input.operations.length||charged!==input.budget.used||
    input.nextFence<=latestFence) invalid();
  const active=state==='CLAIMED'||state==='RECOVERY_PENDING';
  if(active){
    if(!text(input.writer)||!schema(input.lease,['owner','expiresAt','fence'])||input.lease.owner!==input.writer||
      input.lease.fence!==latestFence||!Number.isSafeInteger(input.lease.expiresAt)||input.lease.expiresAt<1) invalid();
  }else if(input.lease!=null||input.writer!=null) invalid();
}
export function createOfflineStore(initial=[]) {
  if(!list(initial))throw Error('INVALID_SNAPSHOT');
  const tasks=new Map(),opOwners=new Map(),audit=[];
  for(const raw of initial){validateTask(raw);if(tasks.has(raw.taskId))throw Error('INVALID_TASK_ID');
    for(const op of raw.operations){if(opOwners.has(op.opId))throw Error('DUPLICATE_GLOBAL_OP_ID');opOwners.set(op.opId,raw.taskId);}tasks.set(raw.taskId,clone(raw));}
  const snapshot=taskId=>tasks.has(taskId)?clone(tasks.get(taskId)):null;
  const snapshotAll=()=>[...tasks.values()].sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0).map(clone);
  const checkOp=(taskId,opId)=>typeof opId!=='string'||!opId.trim()?'INVALID_OPERATION':opOwners.has(opId)?(opOwners.get(opId)===taskId?'OP_ID_SEEN':'OP_ID_COLLISION'):null;
  const commit=(task,op,action)=>{const next={...task,operations:[...task.operations,op],budget:{...task.budget,used:task.budget.used+op.units}};tasks.set(task.taskId,next);opOwners.set(op.opId,task.taskId);audit.push(Object.freeze({taskId:task.taskId,opId:op.opId,revision:next.revision,action,...(op.fence?{fence:op.fence}:{})}));return next;};
  function claim({taskId,writer,revision,head,base,now,ttl,opId}={}){
    const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');const replay=checkOp(taskId,opId);if(replay)return result(false,replay);
    if(typeof writer!=='string'||!writer.trim()||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(ttl)||ttl<=0||!Number.isSafeInteger(now+ttl))return result(false,'INVALID_CLAIM');
    if(t.revision!==revision||t.head!==head||t.base!==base)return result(false,'STALE_CAS');if(t.state!=='QUEUED')return result(false,'NOT_QUEUED');if(t.budget.used>=t.budget.limit)return result(false,'BUDGET_EXHAUSTED');
    if(!Number.isSafeInteger(t.revision+1)||!Number.isSafeInteger(t.nextFence+1))return result(false,'COUNTER_EXHAUSTED');
    const fence=t.nextFence,staged={...t,state:'CLAIMED',writer,revision:t.revision+1,nextFence:fence+1,lease:{owner:writer,expiresAt:now+ttl,fence}};
    return result(true,'CLAIMED',commit(staged,{opId,kind:'CLAIM',units:1,fence},'CLAIMED'));
  }
  function inspectExpired(taskId,now,expectedRevision,expectedFence){const decision=planOfflineRecovery(tasks.get(taskId),{now,expectedRevision,expectedFence});if(decision.action==='WAIT'||decision.action==='NO_ACTION')return{action:'NO_ACTION'};if(decision.action==='HUMAN_RECONCILIATION_REQUIRED')return{action:'RECONCILE_REQUIRED',fence:decision.fence};return{action:'BLOCK',reason:decision.reason};}
  function markRecovery({taskId,revision,fence,now,opId}={}){const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');const replay=checkOp(taskId,opId);if(replay)return result(false,replay);const decision=planOfflineRecovery(t,{now,expectedRevision:revision,expectedFence:fence});if(decision.action!=='HUMAN_RECONCILIATION_REQUIRED')return result(false,decision.reason??decision.action);if(!Number.isSafeInteger(t.revision+1))return result(false,'COUNTER_EXHAUSTED');const next=commit({...t,state:'RECOVERY_PENDING',revision:t.revision+1},{opId,kind:'RECOVERY_MARK',units:0,fence},'RECOVERY_PENDING');return result(true,'RECOVERY_PENDING',next);}
  function reconcileToQueue({taskId,revision,fence,opId}={}){const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');const replay=checkOp(taskId,opId);if(replay)return result(false,replay);if(t.state!=='RECOVERY_PENDING')return result(false,'NOT_RECOVERY_PENDING');if(t.revision!==revision)return result(false,'STALE_CAS');if(t.lease.fence!==fence)return result(false,'STALE_FENCE');if(!Number.isSafeInteger(t.revision+1))return result(false,'COUNTER_EXHAUSTED');const next=commit({...t,state:'QUEUED',writer:null,lease:null,revision:t.revision+1},{opId,kind:'REQUEUE',units:0,fence},'REQUEUED');return result(true,'REQUEUED',next);}
  // Expiry is advisory here; explicit markRecovery revokes completion authority.
  function complete({taskId,revision,fence,writer,opId,outcome='COMPLETED'}={}){const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');const replay=checkOp(taskId,opId);if(replay)return result(false,replay);if(!['COMPLETED','FAILED'].includes(outcome))return result(false,'INVALID_OUTCOME');if(t.state!=='CLAIMED'||t.revision!==revision)return result(false,'STALE_CAS');if(t.writer!==writer||t.lease.fence!==fence)return result(false,'STALE_FENCE');if(!Number.isSafeInteger(t.revision+1))return result(false,'COUNTER_EXHAUSTED');const next=commit({...t,state:outcome,writer:null,lease:null,revision:t.revision+1},{opId,kind:outcome,units:0,fence},outcome);return result(true,outcome,next);}
  const guarded=method=>(args={})=>record(args)?method(args):result(false,'INVALID_OPERATION');
  return Object.freeze({snapshot,snapshotAll,claim:guarded(claim),inspectExpired,markRecovery:guarded(markRecovery),
    // Audit is volatile; the validated snapshot ledger survives process rebuilds.
    reconcileToQueue:guarded(reconcileToQueue),complete:guarded(complete),audit:()=>clone(audit)});
}
