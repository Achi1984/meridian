import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDigest,validateTaskContract} from '../scripts/autonomy-v2-task-contract.mjs';
import {createMemoryAuthority,createTaskQueue,isTaskQueue} from '../scripts/autonomy-v2-task-queue.mjs';
const HEAD='a'.repeat(40),BASE='b'.repeat(40);
const fixture=(suffix='1')=>({schemaVersion:1,taskId:'task-'+suffix,requestId:'request-'+suffix,opId:'enqueue-'+suffix,
  repository:'Achi1984/meridian',targetBranch:'autonomy/offline',expectedHeadSha:HEAD,expectedBaseSha:BASE,
  taskType:'OFFLINE_IMPLEMENTATION',scope:['scripts/autonomy-v2-task-contract.mjs'],allowedOperations:['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS'],
  budgetLimit:4,timeout:100,approvalState:'APPROVED_OFFLINE',reviewState:'OFFLINE_REVIEWED',createdAt:10,expiresAt:1000});
const policy=(now=10)=>({now,repository:'Achi1984/meridian',targetBranch:'autonomy/offline',expectedHeadSha:HEAD,expectedBaseSha:BASE,
  scope:['scripts/autonomy-v2-task-contract.mjs'],allowedOperations:['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS'],budgetMax:4,timeoutMax:100});
const prepare=(q,taskId='task-1',opId='prepare-1',now=11)=>q.prepare({taskId,opId,writer:'writer-1',revision:1,expectedHeadSha:HEAD,expectedBaseSha:BASE,now,units:1});
const finish=(q,args={})=>q.finish({taskId:'task-1',opId:'finish-1',writer:'writer-1',revision:2,fence:1,now:12,units:2,outcome:'COMPLETED',expectedHeadSha:HEAD,expectedBaseSha:BASE,...args});

test('D1 canonical task contract is deterministic and detached',()=>{
  const task=fixture(),check=validateTaskContract(task,policy());assert.equal(check.ok,true);
  assert.equal(canonicalDigest(Object.fromEntries(Object.entries(task).reverse())),check.digest);
  task.scope.push('test/another.js');assert.equal(check.task.scope.length,1);
});
test('D1 schema rejects accessors, extensions, prototype fields, symbols and sparse arrays without invoking getters',()=>{
  let invoked=0;const getter=fixture();Object.defineProperty(getter,'taskId',{enumerable:true,get(){invoked++;return 'task-1';}});
  const nested=fixture();Object.defineProperty(nested.scope,'0',{enumerable:true,get(){invoked++;return 'scripts/a.js';}});
  const hidden=fixture();Object.defineProperty(hidden,'secret',{value:1});
  const symbolic=fixture();symbolic[Symbol('x')]=1;
  const sparse=fixture();sparse.scope=new Array(1);
  for(const task of [getter,nested,hidden,symbolic,sparse,{...fixture(),extra:true},Object.assign(Object.create({inherited:true}),fixture())])assert.equal(validateTaskContract(task,policy()).ok,false);
  assert.equal(invoked,0);
});
test('D1 rejects expired, unauthorized, malformed, negative-zero and reused identity contracts',()=>{
  for(const overrides of [{approvalState:'PENDING'},{reviewState:'PENDING'},{taskId:'request-1'},{expectedHeadSha:'c'.repeat(40)},
    {scope:['../secret']},{scope:['scripts/.github/workflows/a.yml']},{scope:['scripts/trading/a.js']},{scope:['scripts/a\\b.js']},
    {allowedOperations:['EXECUTE_CODEX']},{budgetLimit:5},{timeout:101},{createdAt:-0},{createdAt:11},{expiresAt:10}])
    assert.equal(validateTaskContract({...fixture(),...overrides},policy()).ok,false,JSON.stringify(overrides));
  assert.equal(validateTaskContract(fixture(),policy(1000)).reason,'TASK_EXPIRED');
});
test('D1 malformed canonical data cannot run toJSON/getters or silently coerce',()=>{
  let invoked=0;const accessor={};Object.defineProperty(accessor,'x',{enumerable:true,get(){invoked++;return 1;}});
  for(const value of [accessor,{toJSON(){invoked++;return 'x';}},NaN,Infinity,-0,undefined,new Date(),new Array(3),{x:undefined}])assert.throws(()=>canonicalDigest(value),/INVALID_CANONICAL_DATA/);
  const cycle={};cycle.self=cycle;assert.throws(()=>canonicalDigest(cycle));assert.equal(invoked,0);
});
test('D1 safe lifecycle consumes IDs and budget once and remains immutable',()=>{
  const queue=createTaskQueue();assert.equal(isTaskQueue(queue),true);assert.equal(isTaskQueue({}),false);
  assert.equal(queue.enqueue(fixture(),policy()).ok,true);assert.equal(queue.enqueue(fixture(),policy()).ok,false);
  const prepared=prepare(queue);assert.equal(prepared.ok,true);assert.equal(prepared.entry.fence,1);
  assert.equal(finish(queue).ok,true);assert.equal(queue.get('task-1').budgetUsed,3);
  const before=queue.snapshot();assert.equal(finish(queue).reason,'DUPLICATE_OPERATION_ID');assert.deepEqual(queue.snapshot(),before);
  const entry=queue.get('task-1');entry.task.scope.push('elsewhere');assert.equal(queue.get('task-1').task.scope.length,1);
});
test('D1 global task/request/op namespace collision fails closed',()=>{
  const queue=createTaskQueue();queue.enqueue(fixture(),policy());
  for(const overrides of [{taskId:'request-1'},{requestId:'task-1'},{opId:'enqueue-1'}])assert.equal(queue.enqueue({...fixture('2'),...overrides},policy()).ok,false);
  assert.equal(prepare(queue,'task-1','request-1').ok,false);
});
test('D1 expected-head CAS and fencing reject without consuming rejected operations',()=>{
  const queue=createTaskQueue();queue.enqueue(fixture(),policy());
  const stale=queue.prepare({taskId:'task-1',opId:'prepare-1',writer:'writer-1',revision:1,expectedHeadSha:'c'.repeat(40),expectedBaseSha:BASE,now:11,units:1});
  assert.equal(stale.reason,'STALE_CAS');assert.equal(prepare(queue).ok,true);
  assert.equal(finish(queue,{fence:0}).reason,'STALE_FENCE');assert.equal(finish(queue).ok,true);
});
test('D1 budget and elapsed timeout failure preserve ledger until explicit failure',()=>{
  const queue=createTaskQueue();queue.enqueue(fixture(),policy());prepare(queue);
  const before=queue.snapshot();assert.equal(finish(queue,{units:4}).reason,'BUDGET_EXCEEDED');assert.deepEqual(queue.snapshot(),before);
  assert.equal(finish(queue,{now:111}).reason,'TIMEOUT');
  assert.equal(finish(queue,{now:111,outcome:'FAILED',units:0}).ok,true);assert.equal(queue.get('task-1').budgetUsed,1);
});
test('D1 single writer and shared-authority global CAS reject simultaneous writers',()=>{
  const authority=createMemoryAuthority(),first=createTaskQueue({authority}),other=createTaskQueue({authority});
  assert.equal(first.enqueue(fixture(),policy()).ok,true);assert.equal(other.enqueue(fixture('2'),policy()).reason,'STALE_CHECKPOINT');
  const fresh=createTaskQueue({authority,snapshot:first.snapshot()});first.enqueue(fixture('2'),policy());
  assert.equal(prepare(fresh).reason,'STALE_CHECKPOINT');assert.equal(prepare(first).ok,true);
  assert.equal(prepare(first,'task-2','prepare-2',12).reason,'SINGLE_WRITER_BUSY');
  assert.equal(first.enqueue(fixture('3'),policy(12)).reason,'SINGLE_WRITER_BUSY');
});
test('D1 snapshot replay requires complete ledger and independent non-rollback checkpoint',()=>{
  const authority=createMemoryAuthority(),queue=createTaskQueue({authority});queue.enqueue(fixture(),policy());const prior=queue.snapshot();prepare(queue);
  const restored=createTaskQueue({authority,snapshot:queue.snapshot()});assert.deepEqual(restored.snapshot(),queue.snapshot());
  assert.throws(()=>createTaskQueue({authority,snapshot:prior}),/STALE_CHECKPOINT/);
  for(const mutate of [s=>s.events.pop(),s=>s.tasks[0].budgetUsed=0,s=>s.nextFence=1,s=>s.revision=0,s=>s.tasks[0].task.scope=['scripts/another.js'],s=>s.events[1].writer='other']){
    const damaged=queue.snapshot();mutate(damaged);assert.throws(()=>createTaskQueue({authority,snapshot:damaged}),/INVALID_SNAPSHOT/);
  }
  assert.equal(restored.finish({taskId:'task-1',opId:'interrupt-1',writer:'writer-1',revision:2,fence:1,now:12,units:0,outcome:'INTERRUPTED',expectedHeadSha:HEAD,expectedBaseSha:BASE}).ok,true);
  assert.equal(prepare(restored,'task-1','retry-1',13).reason,'STALE_CAS');
});
test('D1 clock rollback and accessor evidence do not mutate or execute callbacks',()=>{
  const queue=createTaskQueue();queue.enqueue(fixture(),policy());prepare(queue);let invoked=0;
  assert.equal(finish(queue,{now:10}).reason,'CLOCK_ROLLBACK');
  const evidence={};Object.defineProperty(evidence,'descriptorDigest',{enumerable:true,get(){invoked++;return 'a'.repeat(64);}});
  assert.equal(finish(queue,{evidence}).reason,'INVALID_OPERATION');assert.equal(invoked,0);
});
test('D1 finish requires explicit SHA CAS and preflight consumes no operation or budget',()=>{
  const queue=createTaskQueue();queue.enqueue(fixture(),policy());prepare(queue);
  const args={taskId:'task-1',opId:'finish-1',writer:'writer-1',revision:2,fence:1,now:12,units:2,outcome:'COMPLETED',expectedHeadSha:HEAD,expectedBaseSha:BASE};
  const before=queue.snapshot();assert.equal(queue.checkFinish(args).ok,true);assert.deepEqual(queue.snapshot(),before);
  delete args.expectedBaseSha;assert.equal(queue.finish(args).reason,'INVALID_OPERATION');assert.deepEqual(queue.snapshot(),before);
  args.expectedBaseSha=BASE;assert.equal(queue.finish(args).ok,true);
});
