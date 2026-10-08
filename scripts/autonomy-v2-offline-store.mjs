// In-memory, deterministic Phase-1B laboratory only. No disk, network or dispatch.
import {planOfflineRecovery} from './autonomy-v2-offline-recovery.mjs';
const SHA=/^[0-9a-f]{40}$/;
const STATES=new Set(['QUEUED','CLAIMED','RECOVERY_PENDING','COMPLETED','FAILED']);
const clone=value=>structuredClone(value);
const result=(ok,reason,task)=>Object.freeze({ok,reason,...(task?{task:clone(task)}:{})});
function validateTask(input) {
  if(!input||typeof input!=='object'||typeof input.taskId!=='string'||!input.taskId.trim()||!STATES.has(input.state)||
    !Number.isSafeInteger(input.revision)||input.revision<0||!SHA.test(input.head)||!SHA.test(input.base)||
    !Number.isSafeInteger(input.nextFence)||input.nextFence<1||!input.budget||!Number.isSafeInteger(input.budget.limit)||
    input.budget.limit<1||!Number.isSafeInteger(input.budget.used)||input.budget.used<0||input.budget.used>input.budget.limit||
    !Array.isArray(input.operations)||input.operations.some(op=>!op||typeof op.opId!=='string'||!op.opId.trim()||
      typeof op.kind!=='string'||!Number.isSafeInteger(op.units)||op.units<0)) throw Error('INVALID_RESTORED_TASK');
  const ids=input.operations.map(op=>op.opId);let charged=0;
  for(const op of input.operations){charged+=op.units;if(!Number.isSafeInteger(charged))throw Error('INVALID_RESTORED_TASK');}
  if(new Set(ids).size!==ids.length||charged!==input.budget.used)throw Error('INVALID_RESTORED_TASK');
  const active=input.state==='CLAIMED'||input.state==='RECOVERY_PENDING';
  if(active!==Boolean(input.lease)||active!==Boolean(input.writer))throw Error('INVALID_RESTORED_TASK');
  if(active&&(typeof input.writer!=='string'||!input.writer.trim()||input.lease.owner!==input.writer||
    !Number.isSafeInteger(input.lease.fence)||input.lease.fence<1||input.lease.fence>=input.nextFence||
    !Number.isSafeInteger(input.lease.expiresAt)||input.lease.expiresAt<1||
    !input.operations.some(op=>op.kind==='CLAIM'&&op.fence===input.lease.fence)))throw Error('INVALID_RESTORED_TASK');
  if(!active&&(input.lease!=null||input.writer!=null))throw Error('INVALID_RESTORED_TASK');
}
export function createOfflineStore(initial=[]) {
  if(!Array.isArray(initial))throw Error('INVALID_SNAPSHOT');
  const tasks=new Map(),opOwners=new Map(),audit=[];
  for(const raw of initial){validateTask(raw);if(tasks.has(raw.taskId))throw Error('INVALID_TASK_ID');
    for(const op of raw.operations){if(opOwners.has(op.opId))throw Error('DUPLICATE_GLOBAL_OP_ID');opOwners.set(op.opId,raw.taskId);}tasks.set(raw.taskId,clone(raw));}
  const snapshot=taskId=>tasks.has(taskId)?clone(tasks.get(taskId)):null;
  const snapshotAll=()=>[...tasks.values()].sort((a,b)=>a.taskId.localeCompare(b.taskId)).map(clone);
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
  function complete({taskId,revision,fence,writer,opId,outcome='COMPLETED'}={}){const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');const replay=checkOp(taskId,opId);if(replay)return result(false,replay);if(!['COMPLETED','FAILED'].includes(outcome))return result(false,'INVALID_OUTCOME');if(t.state!=='CLAIMED'||t.revision!==revision)return result(false,'STALE_CAS');if(t.writer!==writer||t.lease.fence!==fence)return result(false,'STALE_FENCE');if(!Number.isSafeInteger(t.revision+1))return result(false,'COUNTER_EXHAUSTED');const next=commit({...t,state:outcome,writer:null,lease:null,revision:t.revision+1},{opId,kind:outcome,units:0,fence},outcome);return result(true,outcome,next);}
  return Object.freeze({snapshot,snapshotAll,claim,inspectExpired,markRecovery,reconcileToQueue,complete,audit:()=>clone(audit)});
}
