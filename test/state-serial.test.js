import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialQueue,createSingleFlight} from '../state-serial.js';

test('serial queue prevents overlapping ledger transitions and survives a rejection',async()=>{
  const serial=createSerialQueue();let active=0,maxActive=0;const order=[];
  const task=(id,fail=false)=>serial(async()=>{active++;maxActive=Math.max(maxActive,active);order.push(`start-${id}`);await new Promise(r=>setTimeout(r,3));active--;order.push(`end-${id}`);if(fail)throw new Error('expected');return id;});
  const results=await Promise.allSettled([task(1),task(2,true),task(3)]);
  assert.equal(maxActive,1);assert.deepEqual(order,['start-1','end-1','start-2','end-2','start-3','end-3']);
  assert.equal(results[0].value,1);assert.equal(results[1].status,'rejected');assert.equal(results[2].value,3);
});

test('single flight coalesces overlapping scheduled ticks',async()=>{
  const run=createSingleFlight();let executions=0,release;
  const task=()=>{executions++;return new Promise(resolve=>{release=resolve;});};
  const first=run(task),second=run(task);
  assert.equal(first,second);assert.equal(executions,0);
  await Promise.resolve();assert.equal(executions,1);
  release('done');assert.equal(await first,'done');
  assert.equal(await run(async()=>++executions),2);
});
