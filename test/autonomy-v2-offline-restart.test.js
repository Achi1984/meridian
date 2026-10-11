import test from 'node:test';
import assert from 'node:assert/strict';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const task={taskId:'T',state:'QUEUED',revision:0,head,base,nextFence:1,budget:{limit:2,used:0},operations:[]};
const claim={taskId:'T',writer:'lead',revision:0,head,base,now:100,ttl:10,opId:'claim'};
test('real snapshot rebuild preserves replay protection after crash',()=>{
 const r=replayRestart([task],[{type:'CLAIM',args:claim},{type:'CLAIM',args:claim}],{crashAfter:1});
 assert.equal(r.restarts,1);assert.deepEqual(r.results.map(x=>x.reason),['CLAIMED','OP_ID_SEEN']);assert.equal(r.snapshot[0].budget.used,1);
});
test('restart can recover, requeue and reclaim with a higher fence',()=>{
 const ops=[{type:'CLAIM',args:claim},{type:'MARK_RECOVERY',args:{taskId:'T',revision:1,fence:1,now:110,opId:'recover'}},
  {type:'REQUEUE',args:{taskId:'T',revision:2,fence:1,opId:'requeue'}},
  {type:'CLAIM',args:{...claim,revision:3,now:111,opId:'claim2'}}];
 const r=replayRestart([task],ops,{crashAfter:1});assert.equal(r.results.every(x=>x.ok),true);
 assert.equal(r.snapshot[0].lease.fence,2);assert.equal(r.snapshot[0].budget.used,2);
});
test('unsupported and malformed operations stop deterministically',()=>{
 assert.equal(replayRestart([task],[{type:'DELETE'}]).results[0].reason,'UNSUPPORTED_OPERATION');
 assert.equal(replayRestart([task],[{type:'CLAIM'}]).results[0].reason,'UNKNOWN_TASK');
});
