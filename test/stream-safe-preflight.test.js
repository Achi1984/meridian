import test from 'node:test';
import assert from 'node:assert/strict';
import {compactCheckpoint,compactWorkflowRuns} from '../scripts/stream-safe-preflight.mjs';

test('stream-safe checkpoint keeps only compact resume state',()=>{
  const out=compactCheckpoint({
    mainSha:'1234567890abcdef',
    terminalBuild:'10.0-r52',
    branch:'chore/stream-safe-execution-v2',
    headSha:'fedcba0987654321',
    prNumber:224,
    prState:'open',
    aheadBy:3,
    behindBy:0,
    gates:[
      {name:'MERIDIAN Release Safety',status:'completed',conclusion:'success',logs:'DO NOT LEAK'},
      {name:'MERIDIAN Portfolio Contract v7.63',status:'in_progress',conclusion:null,huge:'x'.repeat(10000)}
    ]
  });
  assert.deepEqual(out,{
    protocol:'STREAM-SAFE-V7',
    resumeToken:'1234567890ab:chore/stream-safe-execution-v2:fedcba098765:pr-224',
    streamBudget:{toolBatches:1,sameStatusPolls:1,maxPayloadBytes:4096,maxPayloadBytesScope:'RENDERED_PROGRESS_AND_LOG_EXCERPTS',maxSourceFileBytes:262144,maxSerializedUploadBytes:393216,maxTurnSeconds:30,checkpointAfterMutation:true},
    mainSha:'1234567890ab',
    terminalBuild:'10.0-r52',
    branch:'chore/stream-safe-execution-v2',
    headSha:'fedcba098765',
    prNumber:224,
    prState:'open',
    aheadBy:3,
    behindBy:0,
    gates:[
      {name:'MERIDIAN Release Safety',status:'completed',conclusion:'success'},
      {name:'MERIDIAN Portfolio Contract v7.63',status:'in_progress',conclusion:null}
    ]
  });
  assert.equal(JSON.stringify(out).includes('DO NOT LEAK'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(out),'utf8')<4096);
});

test('stream-safe workflow compaction caps run count',()=>{
  const runs=Array.from({length:30},(_,i)=>({name:'run-'+i,status:'completed',conclusion:'success'}));
  assert.equal(compactWorkflowRuns(runs).length,12);
});
