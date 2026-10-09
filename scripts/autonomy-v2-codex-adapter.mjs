// D2: isolated synthetic adapter. Approvals are data, not user authentication.
// Queue authority is volatile; no production persistence or Codex dispatch is provided.
import {isOfflineDataRecord as record} from './autonomy-v2-offline-data.mjs';
import {validateTaskContract,canonicalDigest,isTaskId} from './autonomy-v2-task-contract.mjs';
import {isTaskQueue} from './autonomy-v2-task-queue.mjs';
import {prepareFakeExecution,runFakeExecution,validateFakeResult,validateFakeScenario} from './autonomy-v2-fake-runner.mjs';

const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const reject=reason=>Object.freeze({ok:false,reason});
const POLICY_KEYS=['repository','targetBranch','expectedHeadSha','expectedBaseSha','scope','allowedOperations','budgetMax','timeoutMax'];
const TICKET_KEYS=['taskId','writer','revision','fence','startedAt','taskDigest','descriptorDigest','descriptor'];

export function createOfflineCodexAdapter(options){
  if(!exact(options,['queue','policy'])||!isTaskQueue(options.queue)||!exact(options.policy,POLICY_KEYS))throw Error('INVALID_ADAPTER_CONFIGURATION');
  // Verify policy is ordinary canonical data before structuredClone; no callbacks/accessors.
  canonicalDigest(options.policy);
  const queue=options.queue,policy=structuredClone(options.policy),issued=new Map(),attempted=new Set();

  function prepare(args){
    if(!exact(args,['taskId','opId','writer','revision','now'])||!isTaskId(args.taskId)||!isTaskId(args.opId)||
      !isTaskId(args.writer)||!integer(args.revision)||!integer(args.now))return reject('INVALID_OPERATION');
    const entry=queue.get(args.taskId);
    if(!entry)return reject('UNKNOWN_TASK');
    const validation=validateTaskContract(entry.task,{...policy,now:args.now});
    if(!validation.ok)return validation;
    const planned=prepareFakeExecution(entry.task,{...policy,now:args.now});
    if(!planned.ok)return planned;
    const committed=queue.prepare({...args,expectedHeadSha:policy.expectedHeadSha,expectedBaseSha:policy.expectedBaseSha,units:1});
    if(!committed.ok)return committed;
    const current=committed.entry;
    const ticket=Object.freeze({taskId:args.taskId,writer:args.writer,revision:current.revision,fence:current.fence,
      startedAt:current.startedAt,taskDigest:current.digest,descriptorDigest:planned.descriptor.descriptorDigest,descriptor:planned.descriptor});
    issued.set(canonicalDigest(ticket),ticket);
    return Object.freeze({ok:true,reason:'PREPARED',ticket,descriptor:planned.descriptor,entry:current,checkpoint:committed.checkpoint});
  }

  function bindTicket(ticket){
    if(!exact(ticket,TICKET_KEYS)||!isTaskId(ticket.taskId)||!isTaskId(ticket.writer)||!integer(ticket.revision)||
      !integer(ticket.fence)||ticket.fence<1||!integer(ticket.startedAt))return reject('INVALID_TICKET');
    const entry=queue.get(ticket.taskId);
    if(!entry)return reject('UNKNOWN_TASK');
    if(entry.state!=='PREPARED'||entry.revision!==ticket.revision)return reject('STALE_CAS');
    if(entry.fence!==ticket.fence||entry.writer!==ticket.writer||entry.startedAt!==ticket.startedAt)return reject('STALE_FENCE');
    if(entry.digest!==ticket.taskDigest)return reject('INVALID_TICKET');
    const planned=prepareFakeExecution(entry.task,{...policy,now:entry.startedAt});
    if(!planned.ok)return planned;
    try{
      if(ticket.descriptorDigest!==planned.descriptor.descriptorDigest||canonicalDigest(ticket.descriptor)!==canonicalDigest(planned.descriptor))return reject('INVALID_TICKET');
      return {ok:true,entry,descriptor:planned.descriptor,key:canonicalDigest(ticket)};
    }catch{return reject('INVALID_TICKET');}
  }

  function settle(ticket,opId,now,bound,outcome,units,reason,resultDigest=null,result=null){
    const evidence={adapterVersion:1,descriptorDigest:bound.descriptor.descriptorDigest,resultDigest,reason};
    const committed=queue.finish({taskId:ticket.taskId,opId,writer:ticket.writer,revision:ticket.revision,fence:ticket.fence,now,outcome,units,
      expectedHeadSha:policy.expectedHeadSha,expectedBaseSha:policy.expectedBaseSha,evidence});
    if(!committed.ok)return committed;
    issued.delete(bound.key);
    return Object.freeze({ok:true,reason,outcome,entry:committed.entry,checkpoint:committed.checkpoint,evidence,...(result?{result}:{})});
  }

  function finish(args){
    if(!record(args)||!['ticket','opId','now'].every(key=>Object.hasOwn(args,key))||
      Object.keys(args).some(key=>!['ticket','opId','now','scenario'].includes(key))||!isTaskId(args.opId)||!integer(args.now))return reject('INVALID_OPERATION');
    const bound=bindTicket(args.ticket);
    if(!bound.ok)return bound;
    if(!issued.has(bound.key))return reject('TICKET_NOT_ISSUED');
    if(attempted.has(bound.key))return reject('RUN_ALREADY_ATTEMPTED');
    const ready=queue.checkFinish({taskId:args.ticket.taskId,opId:args.opId,writer:args.ticket.writer,
      revision:args.ticket.revision,fence:args.ticket.fence,now:args.now,outcome:'FAILED',units:0,
      expectedHeadSha:policy.expectedHeadSha,expectedBaseSha:policy.expectedBaseSha,
      evidence:{adapterVersion:1,descriptorDigest:bound.descriptor.descriptorDigest,resultDigest:null,reason:'PREEXECUTION_CHECK'}});
    if(!ready.ok)return ready;
    // Clock checks precede even synthetic execution; no retries on a rejected CAS.
    if(args.now<bound.entry.startedAt)return reject('CLOCK_ROLLBACK');
    const scenario=Object.hasOwn(args,'scenario')?args.scenario:{kind:'success'};
    const validation=validateTaskContract(bound.entry.task,{...policy,now:args.now});
    const precheck=!validation.ok?validation.reason:
      args.now-bound.entry.startedAt>=bound.entry.task.timeout?'TIMEOUT':
      !validateFakeScenario(scenario).ok?'INVALID_SCENARIO':null;
    attempted.add(bound.key);
    if(precheck)return settle(args.ticket,args.opId,args.now,bound,'FAILED',0,precheck);
    const synthesized=runFakeExecution(bound.descriptor,scenario);
    if(!synthesized.ok)return settle(args.ticket,args.opId,args.now,bound,'FAILED',0,synthesized.reason);
    const checked=validateFakeResult(synthesized.result,bound.descriptor,
      {budgetRemaining:bound.entry.task.budgetLimit-bound.entry.budgetUsed,timeout:bound.entry.task.timeout});
    if(!checked.ok)return settle(args.ticket,args.opId,args.now,bound,'FAILED',0,checked.reason);
    // The simulated duration must also fit the actual remaining synthetic deadline.
    if(synthesized.result.status==='COMPLETED'&&
      (args.now-bound.entry.startedAt+synthesized.result.durationMs>=bound.entry.task.timeout||
       args.now+synthesized.result.durationMs>=bound.entry.task.expiresAt))return settle(args.ticket,args.opId,args.now,bound,'FAILED',0,'TIMEOUT');
    return settle(args.ticket,args.opId,args.now,bound,synthesized.result.status,synthesized.result.costUnits,synthesized.result.reason,checked.resultDigest,synthesized.result);
  }

  function interrupt(args){
    if(!exact(args,['ticket','opId','now'])||!isTaskId(args.opId)||!integer(args.now))return reject('INVALID_OPERATION');
    const bound=bindTicket(args.ticket);
    if(!bound.ok)return bound;
    if(args.now<bound.entry.startedAt)return reject('CLOCK_ROLLBACK');
    // Restarted adapters may only terminalize the inherited prepared claim.
    return settle(args.ticket,args.opId,args.now,bound,'INTERRUPTED',0,'EXPLICIT_INTERRUPTION');
  }

  return Object.freeze({prepare,finish,interrupt,audit:()=>queue.audit()});
}
