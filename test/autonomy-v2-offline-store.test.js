import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStore} from '../scripts/autonomy-v2-offline-store.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const fixture=()=>({taskId:'T1',state:'QUEUED',revision:0,head,base,budget:{limit:1,used:0}});
const args=(overrides={})=>({taskId:'T1',writer:'lead',revision:0,head,base,now:100,ttl:20,opId:'op1',...overrides});
test('claim consumes budget and issues fenced lease',()=>{
 const s=createOfflineStore([fixture()]);const r=s.claim(args());
 assert.equal(r.ok,true);assert.equal(r.task.budget.used,1);
 assert.deepEqual(r.task.lease,{owner:'lead',expiresAt:120,fence:1});
 assert.equal(s.audit().length,1);
});
test('second writer cannot claim same task',()=>{
 const s=createOfflineStore([fixture()]);s.claim(args());
 assert.equal(s.claim(args({writer:'other',opId:'op2'})).ok,false);
 assert.equal(s.snapshot('T1').writer,'lead');
});
test('stale head and revision fail closed',()=>{
 const s=createOfflineStore([fixture()]);
 assert.equal(s.claim(args({head:base})).reason,'STALE_CAS');
 assert.equal(s.claim(args({revision:1})).reason,'STALE_CAS');
 assert.equal(s.snapshot('T1').budget.used,0);
});
test('quota exhaustion prevents claim',()=>{
 const s=createOfflineStore([{...fixture(),budget:{limit:1,used:1}}]);
 assert.equal(s.claim(args()).reason,'BUDGET_EXHAUSTED');
});
test('lease expiry never automatically transfers writer',()=>{
 const s=createOfflineStore([fixture()]);s.claim(args());
 assert.equal(s.inspectExpired('T1',121).action,'RECONCILE_REQUIRED');
 assert.equal(s.snapshot('T1').writer,'lead');
});
test('operation replay cannot double charge',()=>{
 const s=createOfflineStore([fixture()]);s.claim(args());
 assert.equal(s.claim(args()).reason,'OP_ID_SEEN');
 assert.equal(s.snapshot('T1').budget.used,1);
});
test('returned snapshots cannot mutate store',()=>{
 const s=createOfflineStore([fixture()]);const t=s.snapshot('T1');t.budget.used=99;
 assert.equal(s.snapshot('T1').budget.used,0);
});
