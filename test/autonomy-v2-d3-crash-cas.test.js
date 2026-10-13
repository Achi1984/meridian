/**
 * MERIDIAN D3-09..D3-16: executable offline, synthetic model tests.
 * Operation: MERIDIAN-D3-CRASH-CAS-MODEL-20261009-001
 * THIS IS NOT A DURABLE STORE, A REAL ATTESTATION, OR AN EXECUTION ADAPTER.
 * No network, file I/O, credentials, remote provider, workflow, or trading.
 * node --test --test-reporter=tap test/autonomy-v2-d3-crash-cas.test.js
 * LIMITATION: independent monotone witness is NOT implemented: coherent rollback of
 * the anchor and a matching old journal version is undetectable in this model.
 * LIMITATION: unknown ATTEMPT_INTENT outcome blocks the lease and reserved budget;
 * there is deliberately no automated recovery until an authenticated provider
 * proves the result/absence. Fixture receipts are NOT authenticated evidence.
 * The in-memory model is not the D3 durable store and cannot authorize dispatch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const copy = x => structuredClone(x);
const canonical = x => {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  if (typeof x === 'number' && (!Number.isSafeInteger(x) || Object.is(x, -0))) throw Error('UNSAFE_NUMBER');
  if (x === undefined || typeof x === 'function' || typeof x === 'symbol') throw Error('INVALID_CANONICAL_DATA');
  return JSON.stringify(x);
};
const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
const requireRule = (ok, code) => { if (!ok) throw Error(code); };
const safeAdd = (x, y) => { const n=x+y; requireRule(Number.isSafeInteger(n), 'COUNTER_EXHAUSTED'); return n; };
const POLICY = Object.freeze({ id:'D3-POLICY-SYNTHETIC', repository:'Achi1984/meridian', maxDaily:12, maxTask:8, allowed:['ADMIT','PREPARE','INTENT','RECEIPT','SETTLE','RECOVER'] });
const policyRoot = hash(POLICY);

function finalize(s) {
  s.ledgerRoot = hash(s.events);
  s.replayRoot = hash(s.index);
  return s;
}
function initial() {
  return finalize({schema:2,storeUUID:'meridian-d3-offline-fixture',generation:0,writerEpoch:1,
    fenceHighWater:0,timeHighWater:0,nextFence:1,policyRoot,ledgerRoot:'',replayRoot:'',
    budget:{day:'2026-10-09',cap:12,reserved:0,settled:0,released:0,overrun:0},
    costIncident:false,
    activeLease:null,tasks:{},index:{},receipts:{},events:[],effectCount:0});
}
function anchorFor(s, commandId = 'GENESIS', commandDigest = 'GENESIS') {
  return {storeUUID:s.storeUUID,generation:s.generation,stateDigest:hash(s),ledgerRoot:s.ledgerRoot,
    replayRoot:s.replayRoot,policyRoot:s.policyRoot,fenceHighWater:s.fenceHighWater,
    writerEpoch:s.writerEpoch,timeHighWater:s.timeHighWater,commitOpId:commandId,commitDigest:commandDigest};
}
function same(a,b) { return hash(a)===hash(b); }
function addEvent(s, cmd, digest) {
  requireRule(!s.index[cmd.id], 'OP_REPLAY');
  const event = {id:cmd.id,kind:cmd.kind,taskId:cmd.taskId??null,digest};
  s.events.push(event);
  s.index[cmd.id]=digest;
  s.generation=safeAdd(s.generation,1);
  s.timeHighWater=safeAdd(s.timeHighWater,1);
  const receipt={opId:cmd.id,kind:cmd.kind,taskId:cmd.taskId??null,status:'APPLIED',generation:s.generation};
  s.receipts[cmd.id]=receipt;
  finalize(s);
  return receipt;
}
function transition(committed,cmd) {
  const s=copy(committed);
  const digest=hash(cmd);
  requireRule(typeof cmd.id==='string' && !!cmd.id && POLICY.allowed.includes(cmd.kind), 'INVALID_COMMAND');
  requireRule(!s.index[cmd.id], 'OP_REPLAY');
  if(cmd.kind!=='ADMIT') requireRule(s.tasks[cmd.taskId], 'UNKNOWN_TASK');
  if(cmd.kind==='ADMIT') {
    requireRule(cmd.taskId==='task-A'||cmd.taskId==='task-B','INVALID_TASK');
    requireRule(!s.tasks[cmd.taskId], 'DUPLICATE_TASK');
    requireRule(cmd.limit===8, 'POLICY_DENIED');
    s.tasks[cmd.taskId]={status:'QUEUED',revision:1,fence:0,reservation:0,receipt:null,intent:null,actualCost:0,releasedCost:0,overrun:0};
  } else {
    const t=s.tasks[cmd.taskId];
    requireRule(cmd.revision===t.revision, 'STALE_TASK_REVISION');
    if(cmd.kind==='PREPARE') {
      requireRule(!s.costIncident, 'COST_INCIDENT');
      requireRule(t.status==='QUEUED' && !s.activeLease, 'SINGLE_WRITER_BUSY');
      const used=safeAdd(s.budget.reserved,s.budget.settled);
      requireRule(safeAdd(used,8)<=s.budget.cap,'DAILY_CAP_EXCEEDED');
      const fence=s.nextFence;s.nextFence=safeAdd(s.nextFence,1);
      s.fenceHighWater=fence;t.fence=fence;t.status='PREPARED';t.reservation=8;
      s.budget.reserved=safeAdd(s.budget.reserved,8);
      s.activeLease={taskId:cmd.taskId,writer:'fixture-writer',fence};
    } else if(cmd.kind==='INTENT') {
      requireRule(t.status==='PREPARED' && !!s.activeLease, 'INVALID_TRANSITION');
      requireRule(s.activeLease.taskId===cmd.taskId && s.activeLease.fence===t.fence, 'STALE_FENCE');
      t.status='ATTEMPT_INTENT';t.intent='fake-effect:'+cmd.taskId;
    } else if(cmd.kind==='RECEIPT') {
      requireRule(t.status==='ATTEMPT_INTENT'&&!t.receipt, 'INVALID_TRANSITION');
      const fakeReceipts={3:'synthetic:',8:'synthetic-full:',11:'synthetic-overrun:'};
      requireRule(Object.hasOwn(fakeReceipts,cmd.cost)&&cmd.providerReceipt===fakeReceipts[cmd.cost]+cmd.taskId,
        'UNAUTHENTICATED_FIXTURE_RECEIPT');
      t.receipt={cost:cmd.cost,providerReceipt:cmd.providerReceipt};
    } else if(cmd.kind==='SETTLE') {
      requireRule(t.status==='ATTEMPT_INTENT'&&t.receipt&&s.activeLease?.taskId===cmd.taskId,'RECOVERY_REQUIRED');
      const cost=t.receipt.cost,release=Math.max(0,t.reservation-cost),overrun=Math.max(0,cost-t.reservation);
      s.budget.reserved-=t.reservation;
      s.budget.settled=safeAdd(s.budget.settled,cost);
      s.budget.released=safeAdd(s.budget.released,release);
      s.budget.overrun=safeAdd(s.budget.overrun,overrun);
      t.actualCost=cost;t.releasedCost=release;t.overrun=overrun;
      t.reservation=0;t.status=overrun?'COST_INCIDENT':'COMPLETED';
      s.costIncident ||= overrun>0;s.activeLease=null;
    } else if(cmd.kind==='RECOVER') {
      // Fixture proves there was no committed attempt, hence zero effect/cost.
      requireRule(t.status==='PREPARED'&&t.intent===null&&s.activeLease?.taskId===cmd.taskId,'RECOVERY_REQUIRED');
      s.budget.reserved-=t.reservation;
      s.budget.released=safeAdd(s.budget.released,t.reservation);
      t.releasedCost=t.reservation;
      t.reservation=0;t.status='INTERRUPTED';s.activeLease=null;
    }
    t.revision=safeAdd(t.revision,1);
  }
  const receipt=addEvent(s,cmd,digest);
  return {state:s,receipt,digest};
}

/** Completely independent *in-memory* journal/anchor fixtures; no real durability claim. */
class Fixture {
  constructor() {
    const genesis=initial();this.anchor=anchorFor(genesis);
    this.journal=new Map([[this.anchor.stateDigest,{state:copy(genesis),anchor:copy(this.anchor)}]]);
    this.local=copy(genesis);this.anchorOnline=true;this.expectedUUID=genesis.storeUUID;
  }
  read() {
    requireRule(this.anchorOnline,'AUTHORITY_UNAVAILABLE');
    const a=this.anchor;
    requireRule(a.storeUUID===this.expectedUUID && a.policyRoot===policyRoot,'INSTALLATION_MISMATCH');
    const v=this.journal.get(a.stateDigest);requireRule(!!v,'MISSING_AUTHORITY_VERSION');
    const s=copy(v.state);
    requireRule(hash(s)===a.stateDigest,'CANDIDATE_DIGEST_MISMATCH');
    requireRule(s.storeUUID===a.storeUUID && s.generation===a.generation && s.policyRoot===a.policyRoot &&
      s.ledgerRoot===a.ledgerRoot && s.replayRoot===a.replayRoot &&
      s.fenceHighWater===a.fenceHighWater && s.writerEpoch===a.writerEpoch &&
      s.timeHighWater===a.timeHighWater,'AUTHORITY_MISMATCH');
    requireRule(s.ledgerRoot===hash(s.events)&&s.replayRoot===hash(s.index),'REPLAY_INTEGRITY_FAILURE');
    const rebuilt={};for(const event of s.events){
      requireRule(!rebuilt[event.id] && typeof event.digest==='string','INVALID_EVENT_LEDGER');
      rebuilt[event.id]=event.digest;
    }
    requireRule(same(rebuilt,s.index) && Object.keys(s.receipts).length===s.events.length,'TRUNCATED_REPLAY_INDEX');
    for(let i=0;i<s.events.length;i++){
      const event=s.events[i],receipt=s.receipts[event.id];
      requireRule(!!receipt && receipt.opId===event.id && receipt.kind===event.kind &&
        receipt.taskId===event.taskId && receipt.generation===i+1 &&
        receipt.status==='APPLIED','RECEIPT_EVENT_MISMATCH');
    }
    const taskValues=Object.values(s.tasks);
    const sum=(field)=>taskValues.reduce((total,t)=>safeAdd(total,t[field]),0);
    requireRule(sum('reservation')===s.budget.reserved && sum('actualCost')===s.budget.settled &&
      sum('releasedCost')===s.budget.released && sum('overrun')===s.budget.overrun,
      'BUDGET_TASK_MISMATCH');
    requireRule(s.costIncident===taskValues.some(t=>t.status==='COST_INCIDENT') &&
      (s.activeLease===null || s.tasks[s.activeLease.taskId]?.fence===s.activeLease.fence),
      'LEASE_OR_INCIDENT_MISMATCH');
    requireRule(s.nextFence>s.fenceHighWater && s.budget.reserved>=0 && s.budget.settled>=0 &&
      s.budget.released>=0 && s.budget.overrun>=0 &&
      (s.budget.reserved+s.budget.settled<=s.budget.cap || s.costIncident),
      'INVARIANT_FAILURE');
    return s;
  }
  restart(){this.local=this.read();return copy(this.local);}
  stage(cmd){
    const prev=this.read();
    if(prev.index[cmd.id]){
      requireRule(prev.index[cmd.id]===hash(cmd),'OP_PAYLOAD_CONFLICT');
      return {replayed:true,receipt:copy(prev.receipts[cmd.id]),state:prev};
    }
    if(cmd.expectedGeneration!==undefined)requireRule(prev.generation===cmd.expectedGeneration,'STALE_CHECKPOINT');
    const {state,receipt,digest}=transition(prev,cmd);
    const candidateAnchor=anchorFor(state,cmd.id,digest);
    return {replayed:false,base:copy(this.anchor),candidate:{state,anchor:candidateAnchor},receipt,digest,cmd:copy(cmd)};
  }
  fsync(staged,{fail=false}={}){
    if(fail)throw Error('FSYNC_FAILED');
    const x=copy(staged.candidate);
    this.journal.set(x.anchor.stateDigest,x);
  }
  cas(staged){
    requireRule(this.anchorOnline,'AUTHORITY_UNAVAILABLE');
    requireRule(same(this.anchor,staged.base),'STALE_CHECKPOINT');
    requireRule(this.journal.has(staged.candidate.anchor.stateDigest),'CANDIDATE_NOT_DURABLE');
    this.anchor=copy(staged.candidate.anchor);return copy(this.anchor);
  }
  run(cmd,{crash=null,failFsync=false}={}){
    const staged=this.stage(cmd);
    if(staged.replayed)return {status:'ALREADY_APPLIED',receipt:staged.receipt};
    if(crash==='C0')throw Error('CRASH_C0');
    this.fsync(staged,{fail:failFsync});
    if(crash==='C1')throw Error('CRASH_C1');
    this.cas(staged);
    if(crash==='C2')throw Error('CRASH_C2');
    this.local=copy(staged.candidate.state);
    if(crash==='C3')throw Error('CRASH_C3');
    return {status:'APPLIED',receipt:staged.receipt};
  }
  // No new send/side-effect is ever authorized by reconciliation.
  reconcile(staged){
    const current=this.read();
    // The fixture does not authenticate tickets, but never trusts a caller-supplied digest.
    const actualDigest=hash(staged.cmd);
    requireRule(actualDigest===staged.digest,'STAGED_DIGEST_MISMATCH');
    if(current.index[staged.cmd.id]){
      requireRule(current.index[staged.cmd.id]===actualDigest,'OP_PAYLOAD_CONFLICT');
      return {status:'ALREADY_APPLIED',receipt:copy(current.receipts[staged.cmd.id])};
    }
    if(same(this.anchor,staged.base))return {status:'ABSENT_CONFIRMED'};
    return {status:'STALE_CHECKPOINT'};
  }
}
const operation = (kind,taskId='task-A',revision=null) => {
  const c={id:`op-${kind}-${taskId}`,kind,taskId};
  if(kind==='ADMIT')c.limit=8;
  else c.revision=revision;
  if(kind==='RECEIPT'){c.cost=3;c.providerReceipt=`synthetic:${taskId}`;}
  return c;
};
function scenario(kind){
  const f=new Fixture();const taskId='task-A';
  const steps=['ADMIT','PREPARE','INTENT','RECEIPT','SETTLE'];
  if(kind==='RECOVER')steps.splice(2,3);
  for(const step of steps){
    if(step===kind)break;
    const rev=f.read().tasks[taskId]?.revision??null;
    f.run(operation(step,taskId,rev));
  }
  const rev=f.read().tasks[taskId]?.revision??null;
  return {f,cmd:operation(kind,taskId,rev)};
}
const kinds=['ADMIT','PREPARE','INTENT','RECEIPT','SETTLE','RECOVER'];
const observable=s=>({generation:s.generation,ledgerRoot:s.ledgerRoot,replayRoot:s.replayRoot,index:s.index,
  receipts:s.receipts,nextFence:s.nextFence,writerEpoch:s.writerEpoch,timeHighWater:s.timeHighWater,
  activeLease:s.activeLease,budget:s.budget,effectCount:s.effectCount,tasks:s.tasks});

// D3-09: Each precommit crash leaves *all* authority-backed data unchanged.
test('D3-09: C0/C1 precommit crash matrix (all six transitions)',async t=>{
  for(const kind of kinds)for(const cut of ['C0','C1'])await t.test(`${kind} ${cut}`,()=>{
    const {f,cmd}=scenario(kind);const before=f.read(),anchor=copy(f.anchor);
    assert.throws(()=>f.run(cmd,{crash:cut}),new RegExp(`CRASH_${cut}`));
    assert.deepEqual(observable(f.restart()),observable(before));
    assert.deepEqual(f.anchor,anchor);
    assert.equal(f.read().index[cmd.id],undefined);
    assert.equal(f.reconcile(f.stage(cmd)).status,'ABSENT_CONFIRMED');
    assert.equal(f.run(cmd).status,'APPLIED');
  });
});

// D3-10: Every post-CAS/pre-materialization crash is resolved from exact anchor.
test('D3-10: C2 committed before materialization (all six transitions)',async t=>{
  for(const kind of kinds)await t.test(kind,()=>{
    const {f,cmd}=scenario(kind),before=f.read();
    assert.throws(()=>f.run(cmd,{crash:'C2'}),/CRASH_C2/);
    assert.deepEqual(f.local,before,'C2 must occur BEFORE materialization');
    assert.equal(f.read().generation,before.generation+1);
    const committed=f.restart();
    assert.equal(committed.generation,before.generation+1);
    assert.equal(committed.index[cmd.id],hash(cmd));
    const anchor=copy(f.anchor);
    assert.equal(f.run(cmd).status,'ALREADY_APPLIED');
    assert.deepEqual(f.anchor,anchor);assert.equal(committed.effectCount,0);
  });
});

// D3-11: A lost post-materialization response may NEVER commit twice.
test('D3-11: C3 lost acknowledgment exactly-once replay (all six transitions)',async t=>{
  for(const kind of kinds)await t.test(kind,()=>{
    const {f,cmd}=scenario(kind);
    assert.throws(()=>f.run(cmd,{crash:'C3'}),/CRASH_C3/);
    assert.deepEqual(f.local,f.read(),'C3 must occur AFTER materialization');
    const before=observable(f.restart()),anchor=copy(f.anchor),prior=copy(f.read().receipts[cmd.id]);
    assert.deepEqual(f.run(cmd),{status:'ALREADY_APPLIED',receipt:prior});
    assert.deepEqual(observable(f.restart()),before);
    assert.deepEqual(f.anchor,anchor);
    assert.throws(()=>f.run({...cmd,unexpected:'mutated'}),/OP_PAYLOAD_CONFLICT/);
  });
});

test('D3-12: lost CAS acknowledgment: won/absent/competitor and fsync failure',async t=>{
  await t.test('committed-but-ack-lost is reconciled once, no resend',()=>{
    const {f,cmd}=scenario('PREPARE');const staged=f.stage(cmd);f.fsync(staged);f.cas(staged);
    assert.deepEqual(f.reconcile(staged),{status:'ALREADY_APPLIED',receipt:f.read().receipts[cmd.id]});
    assert.equal(f.run(cmd).status,'ALREADY_APPLIED');
  });
  await t.test('absence independently confirmed permits one guarded retry',()=>{
    const {f,cmd}=scenario('PREPARE');const staged=f.stage(cmd);f.fsync(staged);
    assert.equal(f.reconcile(staged).status,'ABSENT_CONFIRMED');
    assert.equal(f.run(cmd).status,'APPLIED');
    assert.equal(f.read().budget.reserved,8);
  });
  await t.test('competing winner invalidates staged candidate',()=>{
    const f=new Fixture();const a=operation('ADMIT'),b=operation('ADMIT','task-B');
    const x=f.stage(a),y=f.stage(b);f.fsync(x);f.fsync(y);f.cas(y);
    assert.equal(f.reconcile(x).status,'STALE_CHECKPOINT');
    assert.throws(()=>f.cas(x),/STALE_CHECKPOINT/);
    assert.equal(f.read().tasks['task-A'],undefined);
  });
  await t.test('fsync failure cannot move trusted anchor',()=>{
    const {f,cmd}=scenario('INTENT'),anchor=copy(f.anchor),before=f.read();
    assert.throws(()=>f.run(cmd,{failFsync:true}),/FSYNC_FAILED/);
    assert.deepEqual(f.anchor,anchor);
    assert.deepEqual(f.restart(),before);
  });
});

test('D3-13: stale local snapshot cannot defeat retained anchor',async t=>{
  await t.test('old local snapshot is ignored; exact latest anchor version wins',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));const old=copy(f.local);
    for(const kind of ['PREPARE','INTENT','RECEIPT','SETTLE']){
      const rev=f.read().tasks['task-A'].revision;f.run(operation(kind,'task-A',rev));
    }
    const expected=observable(f.read());f.local=old;
    assert.deepEqual(observable(f.restart()),expected);
    assert.equal(f.read().fenceHighWater,1);
    assert.equal(f.read().budget.settled,3);
    assert.equal(f.read().budget.released,5);
  });
  await t.test('rollback all local copies cannot invent an older committed state',()=>{
    const f=new Fixture();const old=copy(f.journal);f.run(operation('ADMIT'));f.journal=old;
    assert.throws(()=>f.restart(),/MISSING_AUTHORITY_VERSION/);
    assert.equal(f.anchor.generation,1);
  });
});

test('D3-13 LIMITATION: coherent authority rollback is undetectable without an independent witness',()=>{
  const f=new Fixture();const oldAnchor=copy(f.anchor),oldSnapshot=copy(f.read());
  f.run(operation('ADMIT'));assert.equal(f.read().generation,1);
  // Simulate compromise/rollback of the authority itself, with the old journal retained.
  f.anchor=oldAnchor;f.local=oldSnapshot;
  assert.deepEqual(f.restart(),oldSnapshot);
  assert.equal(f.read().generation,0);
  assert.equal(f.read().tasks['task-A'],undefined);
  // This is a deliberate demonstration of an unsupported threat model, NOT a guard PASS.
});

test('D3-14: mismatched anchor tuple and identity rejected (not coherent anchor rollback)',async t=>{
  for(const field of ['storeUUID','generation','writerEpoch','fenceHighWater','timeHighWater','replayRoot'])await t.test(field,()=>{
    const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('PREPARE','task-A',1));
    if(field==='storeUUID')f.anchor.storeUUID='other-installation';
    else if(field==='replayRoot')f.anchor.replayRoot='old-index';
    else f.anchor[field]=field==='generation'?0:field==='writerEpoch'?0:-1;
    assert.throws(()=>f.restart(),/AUTHORITY_MISMATCH|INSTALLATION_MISMATCH/);
  });
});

test('D3-15: unavailable authority, damaged candidate/replay and speculative pointer',async t=>{
  await t.test('anchor unavailable blocks all commits/read/restart',()=>{
    const f=new Fixture();f.anchorOnline=false;
    assert.throws(()=>f.run(operation('ADMIT')),/AUTHORITY_UNAVAILABLE/);
    assert.throws(()=>f.restart(),/AUTHORITY_UNAVAILABLE/);
  });
  await t.test('corrupted authority-named candidate fails closed',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));f.journal.get(f.anchor.stateDigest).state.tasks['task-A'].status='FORGED';
    assert.throws(()=>f.restart(),/CANDIDATE_DIGEST_MISMATCH/);
  });
  await t.test('truncated replay index and recomputed candidate digest still fails integrity',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));const s=copy(f.read());s.index={};s.replayRoot=hash(s.index);
    const a=anchorFor(s,'forged','forged');f.journal.set(a.stateDigest,{state:s,anchor:a});f.anchor=a;
    assert.throws(()=>f.restart(),/TRUNCATED_REPLAY_INDEX/);
  });
  await t.test('speculative local pointer/candidate ahead of anchor is ignored',()=>{
    const f=new Fixture(),s=f.stage(operation('ADMIT'));f.fsync(s);f.local=copy(s.candidate.state);
    assert.equal(f.restart().generation,0);
    assert.equal(f.read().tasks['task-A'],undefined);
  });
  await t.test('authority-named journal record missing means block, not reset',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));f.journal.delete(f.anchor.stateDigest);
    assert.throws(()=>f.restart(),/MISSING_AUTHORITY_VERSION/);
    assert.equal(f.anchor.generation,1);
  });
});

test('D3 supplementary recovery probe: ATTEMPT_INTENT without receipt retains reservation',async t=>{
  for(const cut of ['C0','C1','C2','C3'])await t.test(`RECEIPT ${cut}`,()=>{
    const {f,cmd}=scenario('RECEIPT');
    assert.equal(f.read().tasks['task-A'].status,'ATTEMPT_INTENT');
    assert.throws(()=>f.run(cmd,{crash:cut}),new RegExp(`CRASH_${cut}`));
    const s=f.restart(),task=s.tasks['task-A'];
    assert.equal(task.status,'ATTEMPT_INTENT');
    assert.equal(s.budget.reserved,8);
    assert.equal(s.budget.settled,0);
    assert.equal(s.budget.released,0);
    assert.equal(s.activeLease?.taskId,'task-A');
    assert.equal(s.effectCount,0);
    if(cut==='C0'||cut==='C1') {
      assert.equal(task.receipt,null);
      assert.throws(()=>f.run(operation('SETTLE','task-A',task.revision)),/RECOVERY_REQUIRED/);
    } else {
      assert.deepEqual(task.receipt,{cost:3,providerReceipt:'synthetic:task-A'});
      assert.equal(f.run(cmd).status,'ALREADY_APPLIED');
    }
    assert.throws(()=>f.run(operation('RECOVER','task-A',task.revision)),/RECOVERY_REQUIRED/);
    assert.throws(()=>f.run(operation('INTENT','task-A',task.revision)),/OP_PAYLOAD_CONFLICT/);
    const secondIntent={...operation('INTENT','task-A',task.revision),id:'op-INTENT-task-A-second'};
    assert.throws(()=>f.run(secondIntent),/INVALID_TRANSITION/);
    assert.equal(f.read().budget.reserved,8);
  });
});

test('D3-16: two in-memory writers, reversed CAS races (not daily-cap coverage)',async t=>{
  for(const winner of ['X','Y'])await t.test(`ADMIT winner ${winner}`,()=>{
    const f=new Fixture();const x=f.stage(operation('ADMIT')),y=f.stage(operation('ADMIT','task-B'));
    f.fsync(x);f.fsync(y);
    const win=winner==='X'?x:y,lose=winner==='X'?y:x;
    f.cas(win);assert.throws(()=>f.cas(lose),/STALE_CHECKPOINT/);
    const after=f.restart();assert.equal(after.generation,1);
    assert.equal(Object.keys(after.tasks).length,1);
    assert.equal(Object.keys(after.index).length,1);
  });
  for(const winner of ['X','Y'])await t.test(`PREPARE CAS winner ${winner}`,()=>{
    const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('ADMIT','task-B'));
    const a=f.stage(operation('PREPARE','task-A',1));
    const b=f.stage(operation('PREPARE','task-B',1));
    f.fsync(a);f.fsync(b);const win=winner==='X'?a:b,lose=winner==='X'?b:a;
    f.cas(win);assert.throws(()=>f.cas(lose),/STALE_CHECKPOINT/);
    const s=f.restart();assert.equal(s.budget.reserved,8);
    assert.equal(s.fenceHighWater,1);assert.equal(s.nextFence,2);
    assert.equal(s.generation,3);assert.equal(s.activeLease.taskId,win.cmd.taskId);
    assert.equal(s.tasks[lose.cmd.taskId].status,'QUEUED');
    assert.equal(Object.keys(s.index).length,3);
  });
});


test('D3-17: earlier applied operation reconciles after later commits',()=>{
  const f=new Fixture();const command=operation('ADMIT');const staged=f.stage(command);
  f.fsync(staged);f.cas(staged);f.local=copy(staged.candidate.state);
  f.run(operation('ADMIT','task-B'));
  assert.deepEqual(f.reconcile(staged),{status:'ALREADY_APPLIED',receipt:f.read().receipts[command.id]});
  assert.equal(f.read().generation,2);
  assert.throws(()=>f.reconcile({...staged,digest:'forged'}),/STAGED_DIGEST_MISMATCH/);
});

test('D3-18: cross-check event receipt association and task budget sums',async t=>{
  await t.test('forged unrelated receipt with matching count is rejected',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));const s=copy(f.read());
    delete s.receipts['op-ADMIT-task-A'];s.receipts['unrelated']={opId:'unrelated',kind:'ADMIT',taskId:'task-A',status:'APPLIED',generation:1};
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/RECEIPT_EVENT_MISMATCH/);
  });
  await t.test('receipt generation mismatch fails even when hashes are recomputed',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));const s=copy(f.read());
    s.receipts['op-ADMIT-task-A'].generation=99;
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/RECEIPT_EVENT_MISMATCH/);
  });
  await t.test('forged reservation mismatch rejected despite valid digest',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('PREPARE','task-A',1));
    const s=copy(f.read());s.budget.reserved=0;
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/BUDGET_TASK_MISMATCH/);
  });
  await t.test('forged settled-cost sum rejected',()=>{
    const f=new Fixture();for(const kind of ['ADMIT','PREPARE','INTENT','RECEIPT','SETTLE']){
      f.run(operation(kind,'task-A',f.read().tasks['task-A']?.revision??null));
    }
    const s=copy(f.read());s.tasks['task-A'].actualCost=0;
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/BUDGET_TASK_MISMATCH/);
  });
});

test('D3-19: actual daily-cap denial after legitimate 8-unit settlement',()=>{
  const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('ADMIT','task-B'));
  for(const kind of ['PREPARE','INTENT'])f.run(operation(kind,'task-A',f.read().tasks['task-A'].revision));
  const full=operation('RECEIPT','task-A',f.read().tasks['task-A'].revision);
  full.cost=8;full.providerReceipt='synthetic-full:task-A';f.run(full);
  f.run(operation('SETTLE','task-A',f.read().tasks['task-A'].revision));
  assert.equal(f.read().budget.settled,8);assert.equal(f.read().budget.reserved,0);
  const before=f.read();
  assert.throws(()=>f.run(operation('PREPARE','task-B',1)),/DAILY_CAP_EXCEEDED/);
  assert.deepEqual(f.read(),before);
});

test('D3-20: synthetic overrun records true cost and freezes new attempts',()=>{
  const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('ADMIT','task-B'));
  for(const kind of ['PREPARE','INTENT'])f.run(operation(kind,'task-A',f.read().tasks['task-A'].revision));
  const over=operation('RECEIPT','task-A',f.read().tasks['task-A'].revision);
  over.cost=11;over.providerReceipt='synthetic-overrun:task-A';f.run(over);
  f.run(operation('SETTLE','task-A',f.read().tasks['task-A'].revision));
  const state=f.read();
  assert.equal(state.tasks['task-A'].status,'COST_INCIDENT');
  assert.deepEqual(state.budget,{day:'2026-10-09',cap:12,reserved:0,settled:11,released:0,overrun:3});
  assert.equal(state.costIncident,true);
  assert.throws(()=>f.run(operation('PREPARE','task-B',1)),/COST_INCIDENT/);
  assert.equal(f.read().effectCount,0);
});

test('D3-21 LIMITATION: unknown ATTEMPT_INTENT liveness fails closed',()=>{
  const f=new Fixture();f.run(operation('ADMIT'));f.run(operation('ADMIT','task-B'));
  for(const kind of ['PREPARE','INTENT'])f.run(operation(kind,'task-A',f.read().tasks['task-A'].revision));
  const state=f.read(),second=operation('PREPARE','task-B',1);
  assert.equal(state.budget.reserved,8);
  assert.throws(()=>f.run(second),/SINGLE_WRITER_BUSY/);
  assert.throws(()=>f.run(operation('RECOVER','task-A',state.tasks['task-A'].revision)),/RECOVERY_REQUIRED/);
  assert.deepEqual(f.read(),state);
  // Await separately authenticated result/absence evidence before a future recovery design.
});

test('D3-22: receipt status, staged digest and incident flag are fail-closed',async t=>{
  await t.test('receipt status must match event even after recomputed hashes',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));const s=copy(f.read());
    s.receipts['op-ADMIT-task-A'].status='FORGED';
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/RECEIPT_EVENT_MISMATCH/);
  });
  await t.test('reconcile recomputes staged command digest rather than trusting caller',()=>{
    const f=new Fixture(),staged=f.stage(operation('ADMIT'));
    f.fsync(staged);f.cas(staged);
    assert.deepEqual(f.reconcile(staged),{status:'ALREADY_APPLIED',receipt:f.read().receipts[staged.cmd.id]});
    assert.throws(()=>f.reconcile({...staged,digest:'forged'}),/STAGED_DIGEST_MISMATCH/);
    assert.throws(()=>f.reconcile({...staged,cmd:{...staged.cmd,limit:7}}),/STAGED_DIGEST_MISMATCH/);
  });
  await t.test('cost incident cannot be cleared by a self-consistent forged candidate',()=>{
    const f=new Fixture();f.run(operation('ADMIT'));
    for(const kind of ['PREPARE','INTENT'])f.run(operation(kind,'task-A',f.read().tasks['task-A'].revision));
    const over=operation('RECEIPT','task-A',f.read().tasks['task-A'].revision);
    over.cost=11;over.providerReceipt='synthetic-overrun:task-A';f.run(over);
    f.run(operation('SETTLE','task-A',f.read().tasks['task-A'].revision));
    const s=copy(f.read());assert.equal(s.costIncident,true);
    s.costIncident=false;
    const anchor=anchorFor(s,'forged','forged');f.journal.set(anchor.stateDigest,{state:s,anchor});f.anchor=anchor;
    assert.throws(()=>f.read(),/LEASE_OR_INCIDENT_MISMATCH/);
  });
});

test('scope assertion: no real effects or external side-effect capabilities',()=>{
  const f=new Fixture();for(const kind of ['ADMIT','PREPARE','INTENT','RECEIPT','SETTLE']){
    const rev=f.read().tasks['task-A']?.revision??null;f.run(operation(kind,'task-A',rev));
  }
  assert.equal(f.read().effectCount,0);
  assert.equal(f.read().budget.reserved,0);
  assert.equal(f.read().budget.settled,3);
  assert.equal(f.read().budget.released,5);
  assert.equal(f.read().tasks['task-A'].status,'COMPLETED');
});
