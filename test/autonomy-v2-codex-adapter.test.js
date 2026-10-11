import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskQueue,createMemoryAuthority} from '../scripts/autonomy-v2-task-queue.mjs';
import {createOfflineCodexAdapter} from '../scripts/autonomy-v2-codex-adapter.mjs';
import {canonicalDigest} from '../scripts/autonomy-v2-task-contract.mjs';
import {prepareFakeExecution,runFakeExecution,validateFakeDescriptor,validateFakeResult} from '../scripts/autonomy-v2-fake-runner.mjs';

const task=(id='one',overrides={})=>({schemaVersion:1,taskId:`task-${id}`,requestId:`request-${id}`,opId:`enqueue-${id}`,
  repository:'Achi1984/meridian',targetBranch:'codex/d1d2',expectedHeadSha:'a'.repeat(40),expectedBaseSha:'b'.repeat(40),
  taskType:'OFFLINE_IMPLEMENTATION',scope:['test/example.test.js','scripts/example.mjs'],
  allowedOperations:['SIMULATE_TESTS','READ_SCOPE','PREPARE_PATCH'],budgetLimit:10,timeout:100,
  approvalState:'APPROVED_OFFLINE',reviewState:'OFFLINE_REVIEWED',createdAt:1000,expiresAt:2000,...overrides});
const policy=()=>({repository:'Achi1984/meridian',targetBranch:'codex/d1d2',expectedHeadSha:'a'.repeat(40),expectedBaseSha:'b'.repeat(40),
  scope:['test/example.test.js','scripts/example.mjs'],allowedOperations:['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS'],budgetMax:10,timeoutMax:100});
function lab(input=task()){
  const authority=createMemoryAuthority(),queue=createTaskQueue({authority}),configuration=policy();
  assert.equal(queue.enqueue(input,{...configuration,now:1000}).ok,true);
  const adapter=createOfflineCodexAdapter({queue,policy:configuration});
  const prepared=adapter.prepare({taskId:input.taskId,opId:'prepare-one',writer:'writer-one',revision:1,now:1001});
  assert.equal(prepared.ok,true,prepared.reason);
  return {authority,queue,adapter,prepared,input,configuration};
}
const finish=(adapter,prepared,scenario={kind:'success'},now=1002)=>adapter.finish({ticket:prepared.ticket,opId:'finish-one',now,scenario});

test('D2 deterministic descriptors, sorted hash-bound artifacts and persisted audit',()=>{
  const first=lab(),second=lab();
  assert.deepEqual(first.prepared.descriptor,second.prepared.descriptor);
  const one=finish(first.adapter,first.prepared),two=finish(second.adapter,second.prepared);
  assert.equal(one.ok,true);assert.equal(one.outcome,'COMPLETED');assert.deepEqual(one,two);
  assert.equal(one.entry.budgetUsed,2);
  assert.deepEqual(one.result.artifacts.map(item=>item.path),['scripts/example.mjs','test/example.test.js']);
  assert.equal(one.evidence.resultDigest,canonicalDigest(one.result));
  const rebuilt=createTaskQueue({authority:first.authority,snapshot:first.queue.snapshot()});
  const adapter=createOfflineCodexAdapter({queue:rebuilt,policy:first.configuration});
  assert.deepEqual(adapter.audit(),first.adapter.audit());
  assert.equal(finish(adapter,first.prepared).ok,false);
});

for(const [kind,reason,state] of [['exception','FAKE_RUNNER_EXCEPTION','FAILED'],['invalid_result','INVALID_FAKE_RESULT','FAILED'],
  ['budget_exceeded','BUDGET_EXCEEDED','FAILED'],['timeout','TIMEOUT','FAILED'],['interruption','FAKE_INTERRUPTION','INTERRUPTED']]){
  test(`D2 ${kind} terminalizes once without extra budget charges`,()=>{
    const {adapter,prepared,queue}=lab();const result=finish(adapter,prepared,{kind});
    assert.equal(result.ok,true,result.reason);assert.equal(result.reason,reason);assert.equal(result.entry.state,state);
    assert.equal(result.entry.budgetUsed,1);assert.equal(queue.audit().length,3);
    assert.equal(finish(adapter,prepared,{kind}).ok,false);assert.equal(queue.audit().length,3);
  });
}

test('D2 prepared claim survives crash but synthetic runner cannot be replayed on restart',()=>{
  const {queue,authority,prepared,configuration}=lab();
  const rebuilt=createTaskQueue({authority,snapshot:queue.snapshot()});
  const restarted=createOfflineCodexAdapter({queue:rebuilt,policy:configuration});
  assert.equal(finish(restarted,prepared).reason,'TICKET_NOT_ISSUED');
  const stopped=restarted.interrupt({ticket:prepared.ticket,opId:'interrupt-one',now:1002});
  assert.equal(stopped.ok,true);assert.equal(stopped.entry.state,'INTERRUPTED');
  assert.equal(stopped.entry.budgetUsed,1);assert.equal(rebuilt.snapshot().activeWriter,null);
});

test('D2 missing approval, scope, head and policy restrictions fail before claim',()=>{
  const input=task(),authority=createMemoryAuthority(),queue=createTaskQueue({authority});
  assert.equal(queue.enqueue(input,{...policy(),now:1000}).ok,true);
  for(const [overrides,reason] of [[{expectedHeadSha:'c'.repeat(40)},'STALE_CAS'],[{scope:['scripts/example.mjs']},'SCOPE_NOT_AUTHORIZED'],
    [{allowedOperations:['READ_SCOPE']},'OPERATION_NOT_AUTHORIZED'],[{budgetMax:1},'LIMIT_NOT_AUTHORIZED']]){
    const adapter=createOfflineCodexAdapter({queue,policy:{...policy(),...overrides}});
    assert.equal(adapter.prepare({taskId:input.taskId,opId:'prepare-one',writer:'writer-one',revision:1,now:1001}).reason,reason);
  }
  assert.equal(queue.audit().length,1);
  assert.equal(prepareFakeExecution({...input,approvalState:'UNAPPROVED'},{...policy(),now:1000}).reason,'MISSING_OFFLINE_APPROVAL');
});

test('D2 ticket substitutions fail CAS and fences without mutation',()=>{
  const {adapter,prepared,queue}=lab();
  for(const [overrides,reason] of [[{revision:1},'STALE_CAS'],[{fence:0},'INVALID_TICKET'],[{writer:'writer-two'},'STALE_FENCE'],
    [{taskDigest:'c'.repeat(64)},'INVALID_TICKET'],[{descriptorDigest:'c'.repeat(64)},'INVALID_TICKET']]){
    assert.equal(adapter.finish({ticket:{...prepared.ticket,...overrides},opId:'finish-one',now:1002}).reason,reason);
  }
  assert.equal(queue.audit().length,2);assert.equal(finish(adapter,prepared).outcome,'COMPLETED');
});

test('D2 malformed scenario, callbacks and null scenario fail closed',()=>{
  for(const scenario of [null,{kind:'success',runner:()=>{throw Error('must not execute');}},{kind:'network'},[]]){
    const {adapter,prepared}=lab();const result=finish(adapter,prepared,scenario);
    assert.equal(result.reason,'INVALID_SCENARIO');assert.equal(result.entry.state,'FAILED');
  }
  assert.throws(()=>createOfflineCodexAdapter({queue:{prepare(){throw Error('must not execute');}},policy:policy()}),/INVALID_ADAPTER_CONFIGURATION/);
});

test('D2 ordinary-data boundary rejects accessors without evaluating them',()=>{
  const {adapter,prepared}=lab();let reads=0;
  const scenario={};Object.defineProperty(scenario,'kind',{enumerable:true,get(){reads++;return 'success';}});
  assert.equal(finish(adapter,prepared,scenario).reason,'INVALID_SCENARIO');
  const limits={timeout:100};Object.defineProperty(limits,'budgetRemaining',{enumerable:true,get(){reads++;return 10;}});
  assert.equal(validateFakeResult({},prepared.descriptor,limits).reason,'INVALID_RUN_LIMITS');
  assert.equal(validateFakeResult({},prepared.descriptor,null).reason,'INVALID_RUN_LIMITS');assert.equal(reads,0);
});

test('D2 recomputes descriptor and result identities; modified hashes and extensions reject',()=>{
  const {prepared}=lab(),descriptor=prepared.descriptor,result=runFakeExecution(descriptor).result;
  const forged=structuredClone(descriptor);forged.task.expectedHeadSha='c'.repeat(40);
  assert.equal(validateFakeDescriptor(forged).ok,false);
  for(const bad of [{...result,network:true},{...result,expectedBaseSha:'d'.repeat(40)},
    {...result,artifacts:[...result.artifacts].reverse()},{...result,costUnits:-1},
    {...result,artifacts:result.artifacts.map(item=>({...item,sha256:'d'.repeat(64)}))}]){
    assert.equal(validateFakeResult(bad,descriptor,{budgetRemaining:9,timeout:100}).reason,'INVALID_FAKE_RESULT');
  }
});

test('D2 budget reservation and wall-clock plus synthetic duration obey boundaries',()=>{
  const short=lab(task('one',{budgetLimit:1}));
  assert.equal(finish(short.adapter,short.prepared).reason,'BUDGET_EXCEEDED');
  assert.equal(short.queue.get(short.input.taskId).budgetUsed,1);
  const timed=lab();assert.equal(finish(timed.adapter,timed.prepared,{kind:'success'},1100).reason,'TIMEOUT');
  const expired=lab();assert.equal(finish(expired.adapter,expired.prepared,{kind:'success'},2000).reason,'TASK_EXPIRED');
});

test('D2 concurrent tasks use one queue writer and release only at terminal transition',()=>{
  const authority=createMemoryAuthority(),queue=createTaskQueue({authority}),configuration=policy();
  for(const id of ['one','two'])assert.equal(queue.enqueue(task(id),{...configuration,now:1000}).ok,true);
  const adapter=createOfflineCodexAdapter({queue,policy:configuration});
  const first=adapter.prepare({taskId:'task-one',opId:'prepare-one',writer:'writer-one',revision:1,now:1001});
  assert.equal(adapter.prepare({taskId:'task-two',opId:'prepare-two',writer:'writer-two',revision:1,now:1001}).reason,'SINGLE_WRITER_BUSY');
  assert.equal(finish(adapter,first).ok,true);
  const second=adapter.prepare({taskId:'task-two',opId:'prepare-two',writer:'writer-two',revision:1,now:1003});
  assert.equal(second.ok,true);assert.equal(second.ticket.fence,2);
  assert.equal(adapter.interrupt({ticket:second.ticket,opId:'interrupt-two',now:1004}).ok,true);
});

test('D2 denied duplicate operation leaves the prepared runner available to an explicit new operation',()=>{
  const {adapter,prepared,queue}=lab();
  for(const method of ['finish','interrupt']){
    const denied=adapter[method]({ticket:prepared.ticket,opId:'prepare-one',now:1002});
    assert.equal(denied.reason,'DUPLICATE_OPERATION_ID');assert.equal(queue.audit().length,2);
  }
  assert.equal(finish(adapter,prepared).outcome,'COMPLETED');
});

test('D2 stale shared authority rejects before synthetic execution or attempt consumption',()=>{
  const {adapter,prepared,queue,authority}=lab();
  const competing=createTaskQueue({authority,snapshot:queue.snapshot()});
  assert.equal(competing.finish({taskId:'task-one',opId:'competing-interrupt',writer:'writer-one',revision:2,
    fence:1,now:1002,outcome:'INTERRUPTED',units:0,expectedHeadSha:'a'.repeat(40),expectedBaseSha:'b'.repeat(40)}).ok,true);
  const stale=finish(adapter,prepared);
  assert.equal(stale.reason,'STALE_CHECKPOINT');assert.equal(queue.audit().length,2);
  assert.equal(finish(adapter,prepared).reason,'STALE_CHECKPOINT');
});
