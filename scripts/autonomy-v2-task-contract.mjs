// D1: synthetic offline task contract. Caller policy is not identity authentication.
import {createHash} from 'node:crypto';
import {isOfflineDataRecord as record,isOfflineDataArray as list} from './autonomy-v2-offline-data.mjs';

export const TASK_SCHEMA_VERSION=1;
export const TASK_OPERATIONS=Object.freeze(['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS']);
const FIELDS=['schemaVersion','taskId','requestId','opId','repository','targetBranch','expectedHeadSha','expectedBaseSha','taskType','scope','allowedOperations','budgetLimit','timeout','approvalState','reviewState','createdAt','expiresAt'];
export const isTaskId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(value);
const safeInteger=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
const exact=(value,keys)=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const branch=value=>typeof value==='string'&&value.length<=128&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)&&!value.includes('..')&&!value.includes('//')&&!value.endsWith('/')&&!value.endsWith('.')&&!value.split('/').some(part=>part.endsWith('.lock')||part.startsWith('.'));
const sha=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
export function isTaskScopePath(value){
  return typeof value==='string'&&value.length<=256&&/^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(value)&&!value.includes('//')&&
    value.split('/').every(part=>part!=='.'&&part!=='..'&&part!==''&&!/^(?:\.git(?:hub)?|\.aws|\.codex|\.agents|\.env.*|credentials?|secrets?|trading)$/i.test(part))&&
    !/(?:^|\/)(?:[^/]*\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519)$/i.test(value);
}
const uniqueArray=(value,test)=>list(value)&&value.length>0&&value.length<=256&&value.every(test)&&new Set(value).size===value.length;

// JSON-only canonicalization: never invokes data accessors, toJSON or sparse-array getters.
function canonical(value,seen,depth){
  if(depth>64)throw Error('INVALID_CANONICAL_DATA');
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))throw Error('INVALID_CANONICAL_DATA');return String(value);}
  if(seen.has(value))throw Error('INVALID_CANONICAL_DATA');
  if(!record(value)&&!list(value))throw Error('INVALID_CANONICAL_DATA');
  seen.add(value);
  const output=list(value)?'['+value.map(item=>canonical(item,seen,depth+1)).join(',')+']':
    '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key],seen,depth+1)).join(',')+'}';
  seen.delete(value);return output;
}
export function canonicalDigest(value){return createHash('sha256').update(canonical(value,new Set(),0)).digest('hex');}

export function validateTaskContract(task,context={}){
  const reject=reason=>Object.freeze({ok:false,reason});
  if(!exact(task,FIELDS))return reject('INVALID_TASK_SCHEMA');
  if(task.schemaVersion!==1||![task.taskId,task.requestId,task.opId].every(isTaskId)||new Set([task.taskId,task.requestId,task.opId]).size!==3||
    task.repository!=='Achi1984/meridian'||!branch(task.targetBranch)||!sha(task.expectedHeadSha)||!sha(task.expectedBaseSha)||
    task.taskType!=='OFFLINE_IMPLEMENTATION'||!uniqueArray(task.scope,isTaskScopePath)||!uniqueArray(task.allowedOperations,item=>TASK_OPERATIONS.includes(item))||
    !safeInteger(task.budgetLimit)||task.budgetLimit<1||!safeInteger(task.timeout)||task.timeout<1||
    !safeInteger(task.createdAt)||!safeInteger(task.expiresAt)||task.expiresAt<=task.createdAt||task.timeout>task.expiresAt-task.createdAt)
    return reject('INVALID_TASK_CONTRACT');
  if(task.approvalState!=='APPROVED_OFFLINE'||task.reviewState!=='OFFLINE_REVIEWED')return reject('MISSING_OFFLINE_APPROVAL');
  if(!record(context)||!safeInteger(context.now)||!uniqueArray(context.scope,isTaskScopePath)||
    !uniqueArray(context.allowedOperations,item=>TASK_OPERATIONS.includes(item))||!safeInteger(context.budgetMax)||context.budgetMax<1||!safeInteger(context.timeoutMax)||context.timeoutMax<1)
    return reject('INVALID_AUTHORIZATION_CONTEXT');
  if(context.now<task.createdAt)return reject('TASK_NOT_YET_VALID');
  if(context.now>=task.expiresAt)return reject('TASK_EXPIRED');
  if(context.repository!==task.repository||context.targetBranch!==task.targetBranch)return reject('TARGET_NOT_AUTHORIZED');
  if(context.expectedHeadSha!==task.expectedHeadSha||context.expectedBaseSha!==task.expectedBaseSha)return reject('STALE_CAS');
  if(!task.scope.every(path=>context.scope.includes(path)))return reject('SCOPE_NOT_AUTHORIZED');
  if(!task.allowedOperations.every(op=>context.allowedOperations.includes(op)))return reject('OPERATION_NOT_AUTHORIZED');
  if(task.budgetLimit>context.budgetMax||task.timeout>context.timeoutMax)return reject('LIMIT_NOT_AUTHORIZED');
  return Object.freeze({ok:true,reason:'VALID_TASK',task:structuredClone(task),digest:canonicalDigest(task)});
}
