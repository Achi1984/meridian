// D2 laboratory: pure metadata synthesis. No jobs, credentials, IO or callbacks.
import {validateTaskContract,canonicalDigest} from './autonomy-v2-task-contract.mjs';
import {isOfflineDataRecord as record,isOfflineDataArray as list} from './autonomy-v2-offline-data.mjs';

const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const SCENARIOS=['success','exception','invalid_result','budget_exceeded','timeout','interruption'];
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const selfContext=task=>({now:task.createdAt,repository:task.repository,targetBranch:task.targetBranch,
  expectedHeadSha:task.expectedHeadSha,expectedBaseSha:task.expectedBaseSha,scope:task.scope,
  allowedOperations:task.allowedOperations,budgetMax:task.budgetLimit,timeoutMax:task.timeout});

export function prepareFakeExecution(task,context){
  const validated=validateTaskContract(task,context);
  if(!validated.ok)return validated;
  const body={adapterVersion:1,mode:'OFFLINE_FAKE',task:validated.task,taskDigest:validated.digest};
  return freeze({ok:true,reason:'PREPARED',descriptor:{...body,descriptorDigest:canonicalDigest(body)}});
}

export function validateFakeDescriptor(descriptor){
  if(!exact(descriptor,['adapterVersion','mode','task','taskDigest','descriptorDigest'])||descriptor.adapterVersion!==1||
    descriptor.mode!=='OFFLINE_FAKE'||!record(descriptor.task)||!hash(descriptor.taskDigest)||!hash(descriptor.descriptorDigest))
    return {ok:false,reason:'INVALID_DESCRIPTOR'};
  const validation=validateTaskContract(descriptor.task,selfContext(descriptor.task));
  if(!validation.ok)return {ok:false,reason:'INVALID_DESCRIPTOR'};
  if(validation.digest!==descriptor.taskDigest)return {ok:false,reason:'INVALID_DESCRIPTOR'};
  const {descriptorDigest,...body}=descriptor;
  if(canonicalDigest(body)!==descriptorDigest)return {ok:false,reason:'INVALID_DESCRIPTOR'};
  return {ok:true,reason:'VALID_DESCRIPTOR'};
}

export function validateFakeScenario(scenario){
  return exact(scenario,['kind'])&&SCENARIOS.includes(scenario.kind)?{ok:true,reason:'VALID_SCENARIO'}:{ok:false,reason:'INVALID_SCENARIO'};
}

export function runFakeExecution(descriptor,scenario={kind:'success'}){
  const checked=validateFakeDescriptor(descriptor);
  if(!checked.ok)return checked;
  const fault=validateFakeScenario(scenario);
  if(!fault.ok)return fault;
  const task=descriptor.task;
  const failure=scenario.kind==='exception'||scenario.kind==='interruption';
  const status=scenario.kind==='interruption'?'INTERRUPTED':failure?'FAILED':'COMPLETED';
  const reason=scenario.kind==='exception'?'FAKE_RUNNER_EXCEPTION':scenario.kind==='interruption'?'FAKE_INTERRUPTION':'SIMULATED_SUCCESS';
  const artifacts=failure?[]:[...task.scope].sort().map(path=>({path,kind:'SIMULATED_METADATA',sizeBytes:0,
    sha256:canonicalDigest({descriptorDigest:descriptor.descriptorDigest,path,operations:[...task.allowedOperations].sort()})}));
  const result={adapterVersion:1,mode:'OFFLINE_FAKE',taskId:task.taskId,taskDigest:descriptor.taskDigest,
    descriptorDigest:descriptor.descriptorDigest,expectedHeadSha:task.expectedHeadSha,expectedBaseSha:task.expectedBaseSha,
    status,reason,costUnits:failure?0:scenario.kind==='budget_exceeded'?task.budgetLimit+1:1,
    durationMs:failure?0:scenario.kind==='timeout'?task.timeout:1,artifacts};
  if(scenario.kind==='invalid_result')result.artifacts=[{path:'../outside',sha256:'invalid'}];
  return freeze({ok:true,reason:'SIMULATED',result});
}

export function validateFakeResult(result,descriptor,limits={}){
  const reject=reason=>({ok:false,reason});
  if(!exact(limits,['budgetRemaining','timeout']))return reject('INVALID_RUN_LIMITS');
  const {budgetRemaining,timeout}=limits;
  if(!validateFakeDescriptor(descriptor).ok)return reject('INVALID_DESCRIPTOR');
  if(!exact(result,['adapterVersion','mode','taskId','taskDigest','descriptorDigest','expectedHeadSha','expectedBaseSha','status','reason','costUnits','durationMs','artifacts'])||
    result.adapterVersion!==1||result.mode!=='OFFLINE_FAKE'||result.taskId!==descriptor.task.taskId||result.taskDigest!==descriptor.taskDigest||
    result.descriptorDigest!==descriptor.descriptorDigest||result.expectedHeadSha!==descriptor.task.expectedHeadSha||
    result.expectedBaseSha!==descriptor.task.expectedBaseSha||!['COMPLETED','FAILED','INTERRUPTED'].includes(result.status)||
    !['SIMULATED_SUCCESS','FAKE_RUNNER_EXCEPTION','FAKE_INTERRUPTION'].includes(result.reason)||!integer(result.costUnits)||
    !integer(result.durationMs)||!list(result.artifacts)||result.artifacts.length>descriptor.task.scope.length)return reject('INVALID_FAKE_RESULT');
  if(!integer(budgetRemaining)||!integer(timeout)||timeout<1)return reject('INVALID_RUN_LIMITS');
  const failed=result.status!=='COMPLETED';
  if(failed&&(result.costUnits!==0||result.durationMs!==0||result.artifacts.length!==0)||
    result.status==='COMPLETED'&&(result.reason!=='SIMULATED_SUCCESS'||result.costUnits<1||result.durationMs<1)||
    result.status==='FAILED'&&result.reason!=='FAKE_RUNNER_EXCEPTION'||result.status==='INTERRUPTED'&&result.reason!=='FAKE_INTERRUPTION')return reject('INVALID_FAKE_RESULT');
  if(result.costUnits>budgetRemaining)return reject('BUDGET_EXCEEDED');
  if(result.durationMs>=timeout)return reject('TIMEOUT');
  if(!failed&&result.artifacts.length!==descriptor.task.scope.length)return reject('INVALID_FAKE_RESULT');
  const sortedScope=[...descriptor.task.scope].sort();
  for(let index=0;index<result.artifacts.length;index++){
    const artifact=result.artifacts[index];
    if(!exact(artifact,['path','kind','sizeBytes','sha256'])||artifact.path!==sortedScope[index]||artifact.kind!=='SIMULATED_METADATA'||
      artifact.sizeBytes!==0||artifact.sha256!==canonicalDigest({descriptorDigest:descriptor.descriptorDigest,path:artifact.path,operations:[...descriptor.task.allowedOperations].sort()}))return reject('INVALID_FAKE_RESULT');
  }
  return {ok:true,reason:'VALID_FAKE_RESULT',resultDigest:canonicalDigest(result)};
}
