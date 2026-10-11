// D1 laboratory ledger. No filesystem, network, credential, dispatch or real job access.
import {isOfflineDataRecord as record,isOfflineDataArray as list} from './autonomy-v2-offline-data.mjs';
import {canonicalDigest,validateTaskContract,isTaskId} from './autonomy-v2-task-contract.mjs';
const clone=value=>structuredClone(value);
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const authorities=new WeakMap(),queues=new WeakSet();
const initial=()=>({schemaVersion:1,revision:0,nextFence:1,lastNow:0,activeWriter:null,tasks:[],events:[]});
const checkpoint=state=>({revision:state.revision,nextFence:state.nextFence,lastNow:state.lastNow,digest:canonicalDigest(state)});
const same=(a,b)=>canonicalDigest(a)===canonicalDigest(b);
const reply=(ok,reason,entry,point)=>Object.freeze({ok,reason,...(entry?{entry:clone(entry)}:{}),...(point?{checkpoint:clone(point)}:{})});

// This authority must remain independently trusted and retained across simulated restarts.
// It is deliberately volatile: D3 needs a transactional persistent external authority.
export function createMemoryAuthority(){
  const api=Object.freeze({checkpoint:()=>clone(authorities.get(api).checkpoint)});
  authorities.set(api,{checkpoint:checkpoint(initial())});return api;
}
export const isTaskQueue=value=>queues.has(value);

function validEvidence(value){return value===null||(exact(value,['adapterVersion','descriptorDigest','resultDigest','reason'])&&
  value.adapterVersion===1&&hash(value.descriptorDigest)&&(value.resultDigest===null||hash(value.resultDigest))&&
  typeof value.reason==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(value.reason));}
function occupied(state,id){return state.tasks.some(entry=>[entry.task.taskId,entry.task.requestId,entry.task.opId].includes(id))||state.events.some(event=>event.opId===id);}
function requireCondition(condition,reason){if(!condition)throw Error(reason);}

// Replay is the sole state reducer for both live transitions and snapshot validation.
function reduce(state,event){
  requireCondition(record(event)&&integer(event.now)&&event.now>=state.lastNow,'CLOCK_ROLLBACK');
  requireCondition(isTaskId(event.opId)&&!occupied(state,event.opId),'DUPLICATE_OPERATION_ID');
  requireCondition(Number.isSafeInteger(state.revision+1),'COUNTER_EXHAUSTED');
  const next=clone(state);let entry;
  if(event.kind==='ENQUEUE'){
    requireCondition(exact(event,['kind','opId','now','task']),'INVALID_EVENT');
    requireCondition(state.activeWriter===null,'SINGLE_WRITER_BUSY');
    const task=event.task;
    requireCondition(record(task),'INVALID_TASK_SCHEMA');
    const checked=validateTaskContract(task,{now:event.now,repository:task.repository,targetBranch:task.targetBranch,
      expectedHeadSha:task.expectedHeadSha,expectedBaseSha:task.expectedBaseSha,scope:task.scope,allowedOperations:task.allowedOperations,budgetMax:task.budgetLimit,timeoutMax:task.timeout});
    requireCondition(checked.ok,checked.reason);
    requireCondition(event.opId===task.opId,'INVALID_EVENT');
    requireCondition(![task.taskId,task.requestId,task.opId].some(id=>occupied(state,id)),'DUPLICATE_TASK_OR_REQUEST_ID');
    entry={task:clone(task),digest:checked.digest,state:'QUEUED',revision:1,fence:0,writer:null,startedAt:null,budgetUsed:0};
    next.tasks.push(entry);next.tasks.sort((a,b)=>a.task.taskId<b.task.taskId?-1:1);
  }else{
    const base=['kind','opId','now','taskId','writer','revision','expectedHeadSha','expectedBaseSha','units'];
    requireCondition(exact(event,event.kind==='PREPARE'?base:[...base,'fence','outcome','evidence']),'INVALID_EVENT');
    requireCondition(isTaskId(event.taskId)&&isTaskId(event.writer)&&integer(event.units)&&integer(event.revision),'INVALID_OPERATION');
    entry=next.tasks.find(item=>item.task.taskId===event.taskId);
    requireCondition(Boolean(entry),'UNKNOWN_TASK');
    requireCondition(entry.revision===event.revision&&event.expectedHeadSha===entry.task.expectedHeadSha&&event.expectedBaseSha===entry.task.expectedBaseSha,'STALE_CAS');
    requireCondition(Number.isSafeInteger(entry.revision+1),'COUNTER_EXHAUSTED');
    requireCondition(Number.isSafeInteger(entry.budgetUsed+event.units)&&entry.budgetUsed+event.units<=entry.task.budgetLimit,'BUDGET_EXCEEDED');
    if(event.kind==='PREPARE'){
      requireCondition(entry.state==='QUEUED','INVALID_TRANSITION');
      requireCondition(state.activeWriter===null,'SINGLE_WRITER_BUSY');
      requireCondition(event.now<entry.task.expiresAt,'TASK_EXPIRED');
      requireCondition(event.units>0,'INVALID_BUDGET_RESERVATION');
      requireCondition(Number.isSafeInteger(state.nextFence+1),'COUNTER_EXHAUSTED');
      entry.state='PREPARED';entry.writer=event.writer;entry.fence=state.nextFence;entry.startedAt=event.now;
      next.activeWriter={taskId:entry.task.taskId,writer:event.writer,fence:entry.fence};next.nextFence++;
    }else{
      requireCondition(event.kind==='FINISH'&&['COMPLETED','FAILED','INTERRUPTED'].includes(event.outcome)&&validEvidence(event.evidence),'INVALID_OUTCOME');
      requireCondition(entry.state==='PREPARED','INVALID_TRANSITION');
      requireCondition(integer(event.fence)&&entry.fence===event.fence&&entry.writer===event.writer&&
        state.activeWriter?.taskId===event.taskId&&state.activeWriter.writer===event.writer&&state.activeWriter.fence===event.fence,'STALE_FENCE');
      if(event.outcome==='COMPLETED')requireCondition(event.now<entry.task.expiresAt&&event.now-entry.startedAt<entry.task.timeout,'TIMEOUT');
      entry.state=event.outcome;entry.writer=null;next.activeWriter=null;
    }
    entry.revision++;entry.budgetUsed+=event.units;
  }
  next.revision++;next.lastNow=event.now;next.events.push(clone(event));return {state:next,entry};
}

function restore(raw){
  requireCondition(exact(raw,['schemaVersion','revision','nextFence','lastNow','activeWriter','tasks','events'])&&raw.schemaVersion===1&&
    integer(raw.revision)&&integer(raw.nextFence)&&raw.nextFence>0&&integer(raw.lastNow)&&list(raw.tasks)&&list(raw.events),'INVALID_SNAPSHOT');
  let replay=initial();
  for(const event of raw.events){replay=reduce(replay,event).state;}
  requireCondition(same(replay,raw),'INVALID_SNAPSHOT');return clone(replay);
}

export function createTaskQueue(options={}){
  requireCondition(record(options)&&Object.keys(options).every(key=>['authority','snapshot'].includes(key)),'INVALID_QUEUE_OPTIONS');
  const authority=Object.hasOwn(options,'authority')?options.authority:createMemoryAuthority();
  requireCondition(authorities.has(authority),'INVALID_AUTHORITY');
  let state;
  try{state=Object.hasOwn(options,'snapshot')?restore(options.snapshot):initial();}catch{throw Error('INVALID_SNAPSHOT');}
  requireCondition(same(checkpoint(state),authorities.get(authority).checkpoint),'STALE_CHECKPOINT');
  function commit(event,dryRun=false){
    if(!same(checkpoint(state),authorities.get(authority).checkpoint))return reply(false,'STALE_CHECKPOINT');
    try{
      const updated=reduce(state,event);const point=checkpoint(updated.state);
      if(dryRun)return reply(true,'FINISH_ALLOWED',updated.entry,checkpoint(state));
      // Synchronous compare-and-swap: exactly one writer updates the shared authority.
      authorities.get(authority).checkpoint=point;state=updated.state;
      return reply(true,updated.entry.state,updated.entry,point);
    }catch(error){return reply(false,error.message);}
  }
  function enqueue(task,context){
    const checked=validateTaskContract(task,context);if(!checked.ok)return checked;
    return commit({kind:'ENQUEUE',opId:checked.task.opId,now:context.now,task:checked.task});
  }
  function prepare(args){
    if(!exact(args,['taskId','opId','writer','revision','expectedHeadSha','expectedBaseSha','now','units']))return reply(false,'INVALID_OPERATION');
    try{canonicalDigest(args);}catch{return reply(false,'INVALID_OPERATION');}
    return commit({kind:'PREPARE',...clone(args)});
  }
  function finish(args,dryRun=false){
    if(!record(args))return reply(false,'INVALID_OPERATION');
    const required=['taskId','opId','writer','revision','fence','now','outcome','units','expectedHeadSha','expectedBaseSha'];
    if(!required.every(key=>Object.hasOwn(args,key))||Object.keys(args).some(key=>![...required,'evidence'].includes(key)))return reply(false,'INVALID_OPERATION');
    try{canonicalDigest(args);}catch{return reply(false,'INVALID_OPERATION');}
    return commit({kind:'FINISH',...clone(args),evidence:Object.hasOwn(args,'evidence')?args.evidence:null},dryRun);
  }
  const api=Object.freeze({enqueue,prepare,finish:args=>finish(args),checkFinish:args=>finish(args,true),get:taskId=>{const entry=state.tasks.find(item=>item.task.taskId===taskId);return entry?clone(entry):null;},
    snapshot:()=>clone(state),checkpoint:()=>checkpoint(state),audit:()=>clone(state.events)});
  queues.add(api);return api;
}
