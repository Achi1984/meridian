import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../scripts/autonomy-v2-simulate.mjs';
import { STATES } from '../scripts/autonomy-v2-state.mjs';
const head='a'.repeat(40), base='b'.repeat(40);
const initial=()=>({state:STATES.QUEUED,revision:0,attempts:0,head,base,writer:null,lastOpId:null});
const event=(opId,revision=0)=>({to:STATES.CLAIMED,expectedRevision:revision,expectedHead:head,expectedBase:base,opId,writer:'lead'});
test('synthetic queue claim is deterministic and non-mutating',()=>{
 const t=initial(), result=simulate([event('one')],t);
 assert.equal(result.task.state,STATES.CLAIMED);
 assert.equal(t.state,STATES.QUEUED);
 assert.equal(result.journal.length,1);
});
test('duplicate claim fails closed without second mutation',()=>{
 const result=simulate([event('one'),event('one',1)],initial());
 assert.equal(result.stopped,true);
 assert.equal(result.task.revision,1);
 assert.match(result.journal[1].rejected,/DUPLICATE_OP_ID/);
});
test('stale base rejects and stops',()=>{
 const result=simulate([{...event('one'),expectedBase:head}],initial());
 assert.equal(result.stopped,true);
 assert.equal(result.task.revision,0);
});
test('event quota stops before executing anything',()=>{
 assert.throws(()=>simulate([event('one')],initial(),{maxEvents:0}),/SIMULATION_BUDGET_EXHAUSTED/);
});
