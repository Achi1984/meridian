import test from 'node:test';
import assert from 'node:assert/strict';
import {replayRestart} from '../scripts/autonomy-v2-offline-restart.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const task={taskId:'T',state:'QUEUED',revision:0,head,base,budget:{limit:2,used:0}};
const args={taskId:'T',writer:'lead',revision:0,head,base,now:100,ttl:10,opId:'one'};
test('offline restart harness records exactly one claim',()=>{
 const result=replayRestart([task],[{type:'CLAIM',args}]);
 assert.equal(result.results[0].ok,true);assert.equal(result.audit.length,1);
});
test('duplicate delivery stops without a second claim',()=>{
 const result=replayRestart([task],[{type:'CLAIM',args},{type:'CLAIM',args}]);
 assert.equal(result.results[1].reason,'OP_ID_SEEN');assert.equal(result.audit.length,1);
});
test('unknown operation stops safely',()=>{
 const result=replayRestart([task],[{type:'DELETE',args}]);
 assert.equal(result.results[0].reason,'UNSUPPORTED_OPERATION');assert.equal(result.audit.length,0);
});
