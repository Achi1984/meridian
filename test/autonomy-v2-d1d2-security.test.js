import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTaskContract,canonicalDigest} from '../scripts/autonomy-v2-task-contract.mjs';
import {prepareFakeExecution,runFakeExecution,validateFakeDescriptor,validateFakeResult} from '../scripts/autonomy-v2-fake-runner.mjs';
import {createTaskQueue,createMemoryAuthority} from '../scripts/autonomy-v2-task-queue.mjs';
import {createOfflineCodexAdapter} from '../scripts/autonomy-v2-codex-adapter.mjs';

const head='a'.repeat(40),base='b'.repeat(40);
const task=(suffix='A')=>({schemaVersion:1,taskId:`task-${suffix}`,requestId:`request-${suffix}`,opId:`enqueue-${suffix}`,
  repository:'Achi1984/meridian',targetBranch:'codex/d1d2-offline',expectedHeadSha:head,expectedBaseSha:base,
  taskType:'OFFLINE_IMPLEMENTATION',scope:['scripts/example.mjs','test/example.test.js'],
  allowedOperations:['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS'],budgetLimit:5,timeout:50,
  approvalState:'APPROVED_OFFLINE',reviewState:'OFFLINE_REVIEWED',createdAt:100,expiresAt:300});
const policy=()=>({repository:'Achi1984/meridian',targetBranch:'codex/d1d2-offline',expectedHeadSha:head,expectedBaseSha:base,
  scope:['scripts/example.mjs','test/example.test.js'],allowedOperations:['READ_SCOPE','PREPARE_PATCH','SIMULATE_TESTS'],
  budgetMax:5,timeoutMax:50});
const context=(now=110)=>({...policy(),now});

test('D1 security: deterministic digest ignores record insertion order and isolates returned data',()=>{
  const source=task(),validated=validateTaskContract(source,context());assert.equal(validated.ok,true);
  assert.equal(canonicalDigest(Object.fromEntries(Object.entries(source).reverse())),validated.digest);
  source.scope.push('scripts/evil.mjs');assert.deepEqual(validated.task.scope,task().scope);
});

for(const field of Object.keys(task()))test(`D1 security: missing ${field} fails closed`,()=>{
  const t=task();delete t[field];assert.equal(validateTaskContract(t,context()).ok,false);
});

for(const mutate of [
  t=>{t.taskId=t.requestId;},t=>{t.opId=t.taskId;},t=>{t.opId=t.requestId;},
  t=>{t.schemaVersion=2;},t=>{t.budgetLimit=Infinity;},t=>{t.timeout=Number.MAX_SAFE_INTEGER+1;},
  t=>{t.createdAt=-1;},t=>{t.createdAt=-0;},t=>{t.expiresAt=t.createdAt;},t=>{t.scope=[];},
  t=>{t.scope.push(t.scope[0]);},t=>{t.allowedOperations.push(t.allowedOperations[0]);},
  t=>{t.allowedOperations=['GITHUB_PUSH'];},t=>{t.expectedHeadSha=head.toUpperCase();},
  t=>{t.taskType='CLOUD_RUN';},t=>{t.extra='schema extension';},t=>{t.approvalState='APPROVED_CLOUD';},
  t=>{t.reviewState='PENDING';},t=>{t.targetBranch='refs/heads/../main';}
])test(`D1 security: hostile contract ${mutate.toString()} rejects`,()=>{
  const t=task();mutate(t);assert.equal(validateTaskContract(t,context()).ok,false);
});

for(const path of ['../x','scripts/../x','/absolute','scripts\\x','scripts/%2e%2e/x','scripts//x',
  '.github/workflows/x.yml','foo/.git/config','foo/.env','foo/credentials','foo/trading','foo/private.key'])
test(`D1 security: scope path ${path} rejects`,()=>{
  const t=task();t.scope=[path];const c=context();c.scope=[path];assert.equal(validateTaskContract(t,c).ok,false);
});

test('D1 security: approvals cannot carry over to an altered exact head or base',()=>{
  for(const key of ['expectedHeadSha','expectedBaseSha']){
    const t=task();t[key]='c'.repeat(40);assert.equal(validateTaskContract(t,context()).reason,'STALE_CAS');
  }
});

test('D1 security: expiration, future creation, policy limits and scope are independently checked',()=>{
  assert.equal(validateTaskContract(task(),context(300)).reason,'TASK_EXPIRED');
  assert.equal(validateTaskContract(task(),context(99)).reason,'TASK_NOT_YET_VALID');
  for(const change of [{scope:['scripts/example.mjs']},{allowedOperations:['READ_SCOPE']},{budgetMax:4},{timeoutMax:49},
    {repository:'other/repository'},{targetBranch:'main'}])assert.equal(validateTaskContract(task(),{...context(),...change}).ok,false);
});

test('D1 security: record and array accessors never execute at the contract boundary',()=>{
  let reads=0;
  const t=task();Object.defineProperty(t,'repository',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  assert.equal(validateTaskContract(t,context()).ok,false);
  const c=context();Object.defineProperty(c,'now',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  assert.equal(validateTaskContract(task(),c).ok,false);
  const a=task();Object.defineProperty(a.scope,'0',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  assert.equal(validateTaskContract(a,context()).ok,false);assert.equal(reads,0);
});

test('D1 security: sparse, subclassed, symbol-extended and hidden data reject',()=>{
  for(const altered of [(()=>{const t=task();delete t.scope[0];return t;})(),
    (()=>{const t=task();t.scope=Object.assign(Object.create(Array.prototype),t.scope);return t;})(),
    (()=>{const t=task();t[Symbol('hidden')]=true;return t;})(),
    (()=>{const t=task();Object.defineProperty(t,'hidden',{value:true});return t;})(),
    Object.create(task())])assert.equal(validateTaskContract(altered,context()).ok,false);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>canonicalDigest(cyclic),/INVALID_CANONICAL_DATA/);
});

const fake=()=>prepareFakeExecution(task(),context()).descriptor;
const limits=()=>({budgetRemaining:4,timeout:50});

test('D2 security: fake synthesis is deterministic and produces only metadata inside scope',()=>{
  const descriptor=fake(),one=runFakeExecution(descriptor),two=runFakeExecution(descriptor);
  assert.deepEqual(one,two);assert.equal(validateFakeResult(one.result,descriptor,limits()).ok,true);
  assert.deepEqual(one.result.artifacts.map(a=>a.path),task().scope.sort());
  assert.equal(one.result.artifacts.every(a=>a.kind==='SIMULATED_METADATA'&&a.sizeBytes===0),true);
});

test('D2 security: tampered descriptors reject before synthesis',()=>{
  for(const mutate of [d=>{d.task.expectedHeadSha='c'.repeat(40);},d=>{d.task.allowedOperations=['GITHUB_PUSH'];},
    d=>{d.task.scope=['../x'];},d=>{d.mode='CLOUD';},d=>{delete d.taskDigest;},d=>{d.extra=true;}]){
    const d=structuredClone(fake());mutate(d);assert.equal(validateFakeDescriptor(d).ok,false);assert.equal(runFakeExecution(d).ok,false);
  }
});

test('D2 security: malformed result shapes, incorrect hashes and scope smuggling reject',()=>{
  const descriptor=fake(),valid=runFakeExecution(descriptor).result;
  for(const mutate of [r=>{r.taskId='other';},r=>{r.expectedBaseSha=head;},r=>{r.descriptorDigest='c'.repeat(64);},
    r=>{r.costUnits=NaN;},r=>{r.durationMs=-1;},r=>{r.extra=true;},r=>{r.status='RUNNING';},
    r=>{r.artifacts.reverse();},r=>{r.artifacts[0].path='../outside';},r=>{r.artifacts[0].sha256='c'.repeat(64);},
    r=>{r.artifacts[0].sizeBytes=1;},r=>{r.artifacts.push(r.artifacts[0]);},r=>{delete r.artifacts[0];},
    r=>{r.status='FAILED';r.reason='FAKE_RUNNER_EXCEPTION';},r=>{r.artifacts[0].extra=true;}]){
    const r=structuredClone(valid);mutate(r);assert.equal(validateFakeResult(r,descriptor,limits()).ok,false);
  }
});

test('D2 security: fault outcomes independently enforce budget and timeout',()=>{
  const d=fake();
  for(const [kind,reason] of [['invalid_result','INVALID_FAKE_RESULT'],['budget_exceeded','BUDGET_EXCEEDED'],['timeout','TIMEOUT']]){
    const r=runFakeExecution(d,{kind});assert.equal(validateFakeResult(r.result,d,limits()).reason,reason);
  }
  for(const kind of ['exception','interruption'])assert.equal(validateFakeResult(runFakeExecution(d,{kind}).result,d,limits()).ok,true);
});

test('D2 security: hostile scenarios reject without executing callbacks or accessors',()=>{
  let reads=0;const scenario={};Object.defineProperty(scenario,'kind',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  for(const value of [scenario,null,[],42,{kind:'success',runner:()=>{reads++;}},{kind:'shell'}])assert.equal(runFakeExecution(fake(),value).ok,false);
  assert.equal(reads,0);
});

test('D2 security: malformed result limits reject without executing getters',()=>{
  const d=fake(),r=runFakeExecution(d).result;let reads=0;
  const c={timeout:50};Object.defineProperty(c,'budgetRemaining',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  for(const value of [c,null,[],42,{budgetRemaining:4,timeout:50,extra:true}])assert.equal(validateFakeResult(r,d,value).ok,false);
  assert.equal(reads,0);
});

const setup=()=>{const authority=createMemoryAuthority(),queue=createTaskQueue({authority});
  assert.equal(queue.enqueue(task(),context()).ok,true);return {authority,queue};};
const prep=(overrides={})=>({taskId:'task-A',opId:'prepare-A',writer:'lead',revision:1,
  expectedHeadSha:head,expectedBaseSha:base,now:120,units:1,...overrides});
const done=(overrides={})=>({taskId:'task-A',opId:'finish-A',writer:'lead',revision:2,fence:1,
  expectedHeadSha:head,expectedBaseSha:base,now:130,outcome:'COMPLETED',units:1,...overrides});
const unchanged=(queue,before)=>{assert.deepEqual(queue.snapshot(),before);assert.equal(queue.audit().length,before.events.length);};

test('D1 security: all task/request/operation collisions are global and atomically rejected',()=>{
  for(const firstKey of ['taskId','requestId','opId'])for(const secondKey of ['taskId','requestId','opId']){
    const {queue}=setup(),before=queue.snapshot(),t=task('B');t[secondKey]=task()[firstKey];
    assert.equal(queue.enqueue(t,context()).ok,false);unchanged(queue,before);
  }
  const {queue}=setup();assert.equal(queue.prepare(prep()).ok,true);assert.equal(queue.finish(done()).ok,true);
  const t=task('B');t.requestId='prepare-A';const before=queue.snapshot();assert.equal(queue.enqueue(t,context(140)).ok,false);unchanged(queue,before);
});

test('D1 security: stale head, base and revision do not consume operation IDs',()=>{
  for(const change of [{expectedHeadSha:'c'.repeat(40)},{expectedBaseSha:'c'.repeat(40)},{revision:0}]){
    const {queue}=setup(),before=queue.snapshot();assert.equal(queue.prepare(prep(change)).reason,'STALE_CAS');unchanged(queue,before);
    assert.equal(queue.prepare(prep()).ok,true);
  }
});

test('D1 security: unauthorized enqueue is atomic and does not consume any supplied IDs',()=>{
  const authority=createMemoryAuthority(),queue=createTaskQueue({authority}),before=queue.snapshot(),t=task();t.approvalState='PENDING';
  assert.equal(queue.enqueue(t,context()).ok,false);unchanged(queue,before);
  assert.equal(queue.enqueue(task(),context()).ok,true);
});

test('D1 security: parallel queues sharing an authority enforce CAS before any local mutation',()=>{
  const {authority,queue}=setup(),second=createTaskQueue({authority,snapshot:queue.snapshot()});
  assert.equal(queue.prepare(prep()).ok,true);const before=second.snapshot();
  assert.equal(second.prepare(prep({opId:'parallel',writer:'other'})).reason,'STALE_CHECKPOINT');unchanged(second,before);
  const refreshed=createTaskQueue({authority,snapshot:queue.snapshot()}),active=refreshed.snapshot();
  assert.equal(refreshed.prepare(prep({opId:'parallel',writer:'other',revision:2})).ok,false);unchanged(refreshed,active);
});

test('D1 security: global single writer blocks another task and preserves denied operation IDs',()=>{
  const {queue}=setup();assert.equal(queue.enqueue(task('B'),context()).ok,true);assert.equal(queue.prepare(prep()).ok,true);
  const other=prep({taskId:'task-B',opId:'prepare-B',writer:'other'}),before=queue.snapshot();
  assert.equal(queue.prepare(other).reason,'SINGLE_WRITER_BUSY');unchanged(queue,before);
  assert.equal(queue.finish(done()).ok,true);assert.equal(queue.prepare({...other,now:140}).ok,true);
  assert.equal(queue.get('task-B').fence,2);
});

test('D1 security: retained authority rejects valid older snapshots and fabricated fresh authorities',()=>{
  const {authority,queue}=setup(),old=queue.snapshot();assert.equal(queue.prepare(prep()).ok,true);
  assert.throws(()=>createTaskQueue({authority,snapshot:old}),/STALE_CHECKPOINT/);
  assert.throws(()=>createTaskQueue({authority:createMemoryAuthority(),snapshot:queue.snapshot()}),/STALE_CHECKPOINT/);
  assert.throws(()=>createTaskQueue({authority:{checkpoint:()=>queue.checkpoint()},snapshot:queue.snapshot()}),/INVALID_AUTHORITY/);
  assert.deepEqual(createTaskQueue({authority,snapshot:queue.snapshot()}).snapshot(),queue.snapshot());
});

test('D1 security: snapshot fields and event-derived state cannot be tampered or omitted',()=>{
  const {authority,queue}=setup();assert.equal(queue.prepare(prep()).ok,true);
  for(const mutate of [s=>{s.nextFence=1;},s=>{s.lastNow=0;},s=>{s.revision=0;},s=>{s.activeWriter=null;},
    s=>{s.tasks[0].fence=0;},s=>{s.tasks[0].budgetUsed=0;},s=>{s.tasks[0].state='COMPLETED';},
    s=>{s.events.pop();},s=>{delete s.events[0];},s=>{s.events[1].opId=s.events[0].opId;},
    s=>{s.tasks.pop();},s=>{delete s.tasks;},s=>{s.extra=true;},s=>{s.events[0].task.scope.push('../x');}]){
    const s=queue.snapshot();mutate(s);assert.throws(()=>createTaskQueue({authority,snapshot:s}),/INVALID_SNAPSHOT/);
  }
  const point=authority.checkpoint();point.nextFence=0;assert.notEqual(authority.checkpoint().nextFence,0);
});

test('D1 security: lost acknowledgements reject replay at enqueue, prepare and finish boundaries',()=>{
  const {authority,queue}=setup();let q=createTaskQueue({authority,snapshot:queue.snapshot()}),before=q.snapshot();
  assert.equal(q.enqueue(task(),context()).ok,false);unchanged(q,before);
  assert.equal(q.prepare(prep()).ok,true);q=createTaskQueue({authority,snapshot:q.snapshot()});before=q.snapshot();
  assert.equal(q.prepare(prep()).ok,false);unchanged(q,before);
  assert.equal(q.finish(done()).ok,true);q=createTaskQueue({authority,snapshot:q.snapshot()});before=q.snapshot();
  assert.equal(q.finish(done()).ok,false);unchanged(q,before);
  assert.equal(q.prepare(prep({opId:'retry-with-new-id',revision:3,now:140})).ok,false);unchanged(q,before);
});

test('D1 security: stale fencing, writers, terminal transitions and clock rollback reject atomically',()=>{
  const {queue}=setup();assert.equal(queue.prepare(prep()).ok,true);const before=queue.snapshot();
  for(const change of [{fence:0},{fence:2},{writer:'other'},{revision:1},{now:119},{outcome:'QUEUED'},
    {expectedHeadSha:'c'.repeat(40)},{expectedBaseSha:'c'.repeat(40)}]){
    assert.equal(queue.finish(done(change)).ok,false);unchanged(queue,before);
  }
  assert.equal(queue.finish(done({outcome:'INTERRUPTED',units:0})).ok,true);const interrupted=queue.snapshot();
  assert.equal(queue.prepare(prep({opId:'retry-after-interruption',revision:3,now:140})).ok,false);unchanged(queue,interrupted);
});

test('D1 security: budget reservation, completion budget and timeout fail before commit',()=>{
  const {queue}=setup(),queued=queue.snapshot();assert.equal(queue.prepare(prep({units:6})).reason,'BUDGET_EXCEEDED');unchanged(queue,queued);
  assert.equal(queue.prepare(prep()).ok,true);const before=queue.snapshot();
  assert.equal(queue.finish(done({units:5})).reason,'BUDGET_EXCEEDED');unchanged(queue,before);
  assert.equal(queue.finish(done({now:170})).reason,'TIMEOUT');unchanged(queue,before);
  assert.equal(queue.finish(done({now:169})).ok,true);
});

test('D1 security: malformed queue constructor options never execute accessors',()=>{
  let reads=0;const options={};Object.defineProperty(options,'authority',{enumerable:true,get(){reads++;throw Error('GETTER');}});
  assert.throws(()=>createTaskQueue(options),/INVALID_QUEUE_OPTIONS/);assert.equal(reads,0);
});

const adapterSetup=()=>{const s=setup();return {...s,adapter:createOfflineCodexAdapter({queue:s.queue,policy:policy()})};};
const adapterPrep=(overrides={})=>({taskId:'task-A',opId:'adapter-prepare-A',writer:'lead',revision:1,now:120,...overrides});

test('D2 security: adapter checks policy and exact task SHAs before committing prepare',()=>{
  for(const change of [{expectedHeadSha:'c'.repeat(40)},{expectedBaseSha:'c'.repeat(40)},{budgetMax:4},
    {scope:['scripts/example.mjs']},{allowedOperations:['READ_SCOPE']}]){
    const {queue}=setup(),adapter=createOfflineCodexAdapter({queue,policy:{...policy(),...change}}),before=queue.snapshot();
    assert.equal(adapter.prepare(adapterPrep()).ok,false);unchanged(queue,before);
  }
});

test('D2 security: descriptor, ticket and fence spoofing cannot complete a prepared claim',()=>{
  const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());assert.equal(prepared.ok,true);const before=queue.snapshot();
  for(const mutate of [t=>{t.fence=0;},t=>{t.fence=2;},t=>{t.writer='other';},t=>{t.revision=3;},t=>{t.taskDigest='c'.repeat(64);},
    t=>{t.descriptor.task.scope.push('scripts/evil.mjs');},t=>{t.descriptorDigest='c'.repeat(64);},t=>{t.extra=true;}]){
    const t=structuredClone(prepared.ticket);mutate(t);assert.equal(adapter.finish({ticket:t,opId:'adapter-finish-A',now:130}).ok,false);unchanged(queue,before);
  }
  assert.equal(adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130}).ok,true);
});

test('D2 security: restart refuses runner replay and permits only explicit terminal interruption',()=>{
  const {authority,queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());assert.equal(prepared.ok,true);
  const restored=createTaskQueue({authority,snapshot:queue.snapshot()}),restarted=createOfflineCodexAdapter({queue:restored,policy:policy()}),before=restored.snapshot();
  assert.equal(restarted.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130}).reason,'TICKET_NOT_ISSUED');unchanged(restored,before);
  assert.equal(restarted.interrupt({ticket:prepared.ticket,opId:'adapter-interrupt-A',now:130}).ok,true);
  const interrupted=restored.snapshot();assert.equal(restarted.prepare(adapterPrep({opId:'new-attempt',revision:3,now:140})).ok,false);unchanged(restored,interrupted);
  const rebuilt=createTaskQueue({authority,snapshot:restored.snapshot()}),last=createOfflineCodexAdapter({queue:rebuilt,policy:policy()});
  assert.equal(last.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:140}).ok,false);unchanged(rebuilt,interrupted);
});

test('D2 security: finish duplicate operation IDs reject before attempt consumption',()=>{
  const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());const before=queue.snapshot();
  assert.equal(adapter.finish({ticket:prepared.ticket,opId:'enqueue-A',now:130}).ok,false);unchanged(queue,before);
  assert.equal(adapter.finish({ticket:prepared.ticket,opId:'valid-new-finish',now:130}).ok,true);
});

test('D2 security: denied interruption cannot poison a valid subsequent completion',()=>{
  const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep()),before=queue.snapshot();
  assert.equal(adapter.interrupt({ticket:prepared.ticket,opId:'enqueue-A',now:130}).ok,false);unchanged(queue,before);
  assert.equal(adapter.finish({ticket:prepared.ticket,opId:'valid-finish-A',now:130}).ok,true);
});

test('D2 security: completed acknowledgements replay safely after restart',()=>{
  const {authority,queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());
  const finished=adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130});assert.equal(finished.ok,true);
  const restored=createTaskQueue({authority,snapshot:queue.snapshot()}),next=createOfflineCodexAdapter({queue:restored,policy:policy()}),before=restored.snapshot();
  assert.equal(next.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130}).ok,false);unchanged(restored,before);
  assert.equal(restored.audit().at(-1).evidence.resultDigest,canonicalDigest(finished.result));
});

for(const [kind,reason,state] of [['exception','FAKE_RUNNER_EXCEPTION','FAILED'],['invalid_result','INVALID_FAKE_RESULT','FAILED'],
  ['budget_exceeded','BUDGET_EXCEEDED','FAILED'],['timeout','TIMEOUT','FAILED'],['interruption','FAKE_INTERRUPTION','INTERRUPTED']])
test(`D2 security: adapter ${kind} creates terminal auditable ${state}`,()=>{
  const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());
  const result=adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130,scenario:{kind}});
  assert.equal(result.ok,true);assert.equal(result.reason,reason);assert.equal(queue.get('task-A').state,state);
  assert.equal(queue.get('task-A').budgetUsed,1);assert.equal(queue.snapshot().activeWriter,null);
  assert.equal(queue.audit().at(-1).evidence.reason,reason);
  const before=queue.snapshot();assert.equal(adapter.finish({ticket:prepared.ticket,opId:'replay',now:140}).ok,false);unchanged(queue,before);
});

test('D2 security: synthetic elapsed deadline includes result duration and rejects expired work',()=>{
  for(const now of [169,170,300]){
    const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());
    const result=adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now});
    assert.equal(result.ok,true);assert.equal(queue.get('task-A').state,'FAILED');assert.equal(queue.get('task-A').budgetUsed,1);
    assert.equal(['TIMEOUT','TASK_EXPIRED'].includes(result.reason),true);
  }
});

test('D2 security: explicit malformed scenario never silently selects success',()=>{
  for(const scenario of [null,[],42,{kind:'shell'},{kind:'success',callback:'forbidden'}]){
    const {queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());
    const result=adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:130,scenario});
    assert.equal(result.ok,true);assert.equal(result.reason,'INVALID_SCENARIO');assert.equal(queue.get('task-A').state,'FAILED');
    assert.equal(Object.hasOwn(result,'result'),false);
  }
});

test('D2 security: stale authority preflight rejects before accepting a previously issued ticket',()=>{
  const {authority,queue,adapter}=adapterSetup(),prepared=adapter.prepare(adapterPrep());
  const newerQueue=createTaskQueue({authority,snapshot:queue.snapshot()}),other=createOfflineCodexAdapter({queue:newerQueue,policy:policy()});
  assert.equal(other.interrupt({ticket:prepared.ticket,opId:'external-interruption',now:130}).ok,true);
  const before=queue.snapshot();assert.equal(adapter.finish({ticket:prepared.ticket,opId:'adapter-finish-A',now:140}).reason,'STALE_CHECKPOINT');unchanged(queue,before);
  assert.equal(newerQueue.get('task-A').state,'INTERRUPTED');
});

test('D1 security: successful read-only completion preflight never changes state, audit or IDs',()=>{
  const {queue}=setup();assert.equal(queue.prepare(prep()).ok,true);const before=queue.snapshot();
  assert.equal(queue.checkFinish(done()).ok,true);unchanged(queue,before);
  assert.equal(queue.finish(done()).ok,true);
});

test('D2 security: concurrent adapter preparations preserve the first writer and monotonically fence later work',()=>{
  const {queue,adapter}=adapterSetup();assert.equal(queue.enqueue(task('B'),context()).ok,true);
  const first=adapter.prepare(adapterPrep()),before=queue.snapshot();assert.equal(first.ok,true);
  const other=createOfflineCodexAdapter({queue,policy:policy()});
  assert.equal(other.prepare(adapterPrep({taskId:'task-B',opId:'adapter-prepare-B',writer:'other'})).reason,'SINGLE_WRITER_BUSY');unchanged(queue,before);
  assert.equal(adapter.interrupt({ticket:first.ticket,opId:'adapter-interrupt-A',now:130}).ok,true);
  assert.equal(other.prepare(adapterPrep({taskId:'task-B',opId:'adapter-prepare-B',writer:'other',now:140})).ticket.fence,2);
});
