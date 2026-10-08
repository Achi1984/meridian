// In-memory, deterministic laboratory only. No disk, network or dispatch.
import {planOfflineRecovery} from './autonomy-v2-offline-recovery.mjs';
const SHA=/^[0-9a-f]{40}$/;
const clone=value=>structuredClone(value);
const text=value=>typeof value==='string'&&Boolean(value.trim());
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
const schema=(value,required,optional=[])=>record(value)&&required.every(key=>Object.hasOwn(value,key))&&
  Reflect.ownKeys(value).every(key=>required.includes(key)||optional.includes(key));
const result=(ok,reason,task)=>Object.freeze({ok,reason,...(task?{task:clone(task)}:{})});
const invalid=()=>{throw Error('INVALID_RESTORED_TASK');};

// Replay the complete operation ledger, then compare its derived state with the snapshot.
// Only CLAIM allocates a new fence; recovery/requeue/terminal entries bind that same fence.
function validateTask(input) {
  if(!schema(input,['taskId','state','revision','head','base','nextFence','budget','operations'],['writer','lease'])||
    !text(input.taskId)||!integer(input.revision)||typeof input.head!=='string'||!SHA.test(input.head)||
    typeof input.base!=='string'||!SHA.test(input.base)||!integer(input.nextFence,1)||
    !schema(input.budget,['limit','used'])||!integer(input.budget.limit,1)||!integer(input.budget.used)||
    input.budget.used>input.budget.limit||!Array.isArray(input.operations)||
    input.revision!==input.operations.length)invalid();
  let state='QUEUED',fence=0,charged=0,writer=null,lease=null,claimTime=null,lastExpiry=0;
  const ids=new Set();
  for(const op of input.operations) {
    if(!record(op)||!text(op.opId)||ids.has(op.opId)||!integer(op.fence,1))invalid();
    ids.add(op.opId);
    const common=['opId','kind','units','fence'];
    if(op.kind==='CLAIM') {
      if(!schema(op,[...common,'writer','now','expiresAt'])||state!=='QUEUED'||op.units!==1||
        !text(op.writer)||!integer(op.now)||!integer(op.expiresAt,1)||op.expiresAt<=op.now||
        op.now<lastExpiry||op.fence<=fence||(fence>0&&op.fence!==fence+1))invalid();
      fence=op.fence;charged++;writer=op.writer;claimTime=op.now;
      lease={owner:writer,expiresAt:op.expiresAt,fence};state='CLAIMED';
    } else {
      const timed=op.kind==='RECOVERY_MARK'||op.kind==='COMPLETED'||op.kind==='FAILED';
      if(!schema(op,timed?[...common,'now']:common)||op.units!==0||op.fence!==fence)invalid();
      if(op.kind==='RECOVERY_MARK') {
        if(state!=='CLAIMED'||!integer(op.now)||op.now<lease.expiresAt)invalid();
        state='RECOVERY_PENDING';
      } else if(op.kind==='REQUEUE') {
        if(state!=='RECOVERY_PENDING')invalid();
        lastExpiry=lease.expiresAt;state='QUEUED';writer=null;lease=null;claimTime=null;
      } else if(op.kind==='COMPLETED'||op.kind==='FAILED') {
        if(state!=='CLAIMED'||!integer(op.now)||op.now<claimTime||op.now>=lease.expiresAt)invalid();
        state=op.kind;writer=null;lease=null;claimTime=null;
      } else invalid();
    }
  }
  if(input.state!==state||input.budget.used!==charged||input.nextFence<=fence||
    (fence>0&&input.nextFence!==fence+1))invalid();
  if(lease) {
    if(input.writer!==writer||!schema(input.lease,['owner','expiresAt','fence'])||
      input.lease.owner!==lease.owner||input.lease.expiresAt!==lease.expiresAt||input.lease.fence!==fence)invalid();
  } else if(input.writer!=null||input.lease!=null)invalid();
}

export function createOfflineStore(initial=[]) {
  if(!Array.isArray(initial))throw Error('INVALID_SNAPSHOT');
  const tasks=new Map(),opOwners=new Map(),audit=[];
  for(const raw of initial) {
    // Validate the schema, then clone and revalidate before retaining caller data.
    validateTask(raw);const task=clone(raw);validateTask(task);
    if(tasks.has(task.taskId))throw Error('INVALID_TASK_ID');
    for(const op of task.operations) {
      if(opOwners.has(op.opId))throw Error('DUPLICATE_GLOBAL_OP_ID');
      opOwners.set(op.opId,task.taskId);
    }
    tasks.set(task.taskId,task);
  }
  const snapshot=taskId=>tasks.has(taskId)?clone(tasks.get(taskId)):null;
  const snapshotAll=()=>[...tasks.values()].sort((a,b)=>a.taskId<b.taskId?-1:a.taskId>b.taskId?1:0).map(clone);
  const checkOp=(taskId,opId)=>!text(opId)?'INVALID_OPERATION':opOwners.has(opId)?
    (opOwners.get(opId)===taskId?'OP_ID_SEEN':'OP_ID_COLLISION'):null;
  const commit=(task,op,action)=>{
    const next={...task,operations:[...task.operations,op],budget:{...task.budget,used:task.budget.used+op.units}};
    const event=Object.freeze({taskId:task.taskId,opId:op.opId,revision:next.revision,action,fence:op.fence});
    // Build everything before publishing this synchronous process-local transaction.
    const accepted=result(true,action,next);
    tasks.set(task.taskId,next);opOwners.set(op.opId,task.taskId);audit.push(event);
    return accepted;
  };
  function claim(args={}) {
    if(!record(args))return result(false,'INVALID_OPERATION');
    const {taskId,writer,revision,head,base,now,ttl,opId}=args;
    const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');
    const replay=checkOp(taskId,opId);if(replay)return result(false,replay);
    if(!text(writer)||!integer(now)||!integer(ttl,1)||!integer(now+ttl))return result(false,'INVALID_CLAIM');
    if(t.revision!==revision||t.head!==head||t.base!==base)return result(false,'STALE_CAS');
    if(t.state!=='QUEUED')return result(false,'NOT_QUEUED');
    // After reconciliation the old lease's expiry is a lower bound on a new claim's clock.
    const previousClaim=t.operations.findLast(op=>op.kind==='CLAIM');
    if(previousClaim&&now<previousClaim.expiresAt)return result(false,'INVALID_CLAIM');
    if(t.budget.used>=t.budget.limit)return result(false,'BUDGET_EXHAUSTED');
    if(!integer(t.revision+1)||!integer(t.nextFence+1))return result(false,'COUNTER_EXHAUSTED');
    const fence=t.nextFence,expiresAt=now+ttl;
    const staged={...t,state:'CLAIMED',writer,revision:t.revision+1,nextFence:fence+1,lease:{owner:writer,expiresAt,fence}};
    return commit(staged,{opId,kind:'CLAIM',units:1,fence,writer,now,expiresAt},'CLAIMED');
  }
  function inspectExpired(taskId,now,expectedRevision,expectedFence) {
    const decision=planOfflineRecovery(tasks.get(taskId),{now,expectedRevision,expectedFence});
    if(decision.action==='WAIT'||decision.action==='NO_ACTION')return{action:'NO_ACTION'};
    if(decision.action==='HUMAN_RECONCILIATION_REQUIRED')return{action:'RECONCILE_REQUIRED',fence:decision.fence};
    return{action:'BLOCK',reason:decision.reason};
  }
  function markRecovery(args={}) {
    if(!record(args))return result(false,'INVALID_OPERATION');
    const {taskId,revision,fence,now,opId}=args;
    const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');
    const replay=checkOp(taskId,opId);if(replay)return result(false,replay);
    const decision=planOfflineRecovery(t,{now,expectedRevision:revision,expectedFence:fence});
    if(decision.action!=='HUMAN_RECONCILIATION_REQUIRED')return result(false,decision.reason??decision.action);
    if(!integer(t.revision+1))return result(false,'COUNTER_EXHAUSTED');
    return commit({...t,state:'RECOVERY_PENDING',revision:t.revision+1},
      {opId,kind:'RECOVERY_MARK',units:0,fence,now},'RECOVERY_PENDING');
  }
  // Explicit caller reconciliation only. This lab does not authenticate human authority.
  function reconcileToQueue(args={}) {
    if(!record(args))return result(false,'INVALID_OPERATION');
    const {taskId,revision,fence,opId}=args;
    const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');
    const replay=checkOp(taskId,opId);if(replay)return result(false,replay);
    if(t.state!=='RECOVERY_PENDING')return result(false,'NOT_RECOVERY_PENDING');
    if(t.revision!==revision)return result(false,'STALE_CAS');
    if(t.lease.fence!==fence)return result(false,'STALE_FENCE');
    if(!integer(t.revision+1))return result(false,'COUNTER_EXHAUSTED');
    return commit({...t,state:'QUEUED',writer:null,lease:null,revision:t.revision+1},
      {opId,kind:'REQUEUE',units:0,fence},'REQUEUED');
  }
  function complete(args={}) {
    if(!record(args))return result(false,'INVALID_OPERATION');
    const {taskId,revision,fence,writer,now,opId,outcome='COMPLETED'}=args;
    const t=tasks.get(taskId);if(!t)return result(false,'UNKNOWN_TASK');
    const replay=checkOp(taskId,opId);if(replay)return result(false,replay);
    if(!['COMPLETED','FAILED'].includes(outcome))return result(false,'INVALID_OUTCOME');
    if(t.state!=='CLAIMED'||t.revision!==revision)return result(false,'STALE_CAS');
    if(t.writer!==writer||t.lease.fence!==fence)return result(false,'STALE_FENCE');
    const claimed=t.operations.findLast(op=>op.kind==='CLAIM');
    if(!integer(now)||now<claimed.now)return result(false,'INVALID_COMPLETION');
    if(now>=t.lease.expiresAt)return result(false,'LEASE_EXPIRED');
    if(!integer(t.revision+1))return result(false,'COUNTER_EXHAUSTED');
    return commit({...t,state:outcome,writer:null,lease:null,revision:t.revision+1},
      {opId,kind:outcome,units:0,fence,now},outcome);
  }
  return Object.freeze({snapshot,snapshotAll,claim,inspectExpired,markRecovery,reconcileToQueue,complete,audit:()=>clone(audit)});
}
