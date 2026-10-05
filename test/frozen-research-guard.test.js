import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FROZEN_RESEARCH_BLOBS,gitBlobSha,verifyFrozenResearch} from '../scripts/frozen-research-guard.mjs';

test('frozen research manifest locks canonical V1 and V2 lineage',()=>{
  assert.ok(Object.keys(FROZEN_RESEARCH_BLOBS).length>=14);
  assert.ok('research/paperbot-profit-special-agent-v1.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/paperbot-profit-special-agent-v2.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/PAPERBOT-PROFIT-V2-UPUP-RESULT.md' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-DECISION.md' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/cross-venue-funding-edge-v1-stage-lock.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/cross-venue-funding-edge-v2-stage-lock.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/edge-v1-stage-lock.js' in FROZEN_RESEARCH_BLOBS);
});

test('git blob hashing matches canonical Git object identity',()=>{
  assert.equal(gitBlobSha('test content\n'),'d670460b4b4aece5915caf5c68d12f560a9fe3e4');
});

test('current frozen research files remain byte-identical',()=>{
  const result=verifyFrozenResearch();
  assert.equal(result.ok,true,JSON.stringify(result.mismatches));
  assert.equal(result.mismatches.length,0);
});

test('guard fails closed when a frozen file is modified',()=>{
  const target='research/paperbot-profit-special-agent-v2.js';
  const result=verifyFrozenResearch({
    readFile:path=>path===target?Buffer.from('changed\n'):Buffer.from('')
  });
  assert.equal(result.ok,false);
  assert.ok(result.mismatches.some(x=>x.path===target&&x.reason==='MODIFIED'));
});


test('guard rejects byte changes to frozen Cross-Venue preregistration and stage locks',()=>{
  const targets=[
    'research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md',
    'research/cross-venue-funding-edge-v1-stage-lock.js',
    'research/cross-venue-funding-edge-v2-stage-lock.js'
  ];
  for(const target of targets){
    const result=verifyFrozenResearch({
      readFile:path=>{
        const body=fs.readFileSync(path);
        return path===target?Buffer.concat([body,Buffer.from('\n# synthetic mutation\n')]):body;
      }
    });
    assert.equal(result.ok,false,target);
    assert.ok(result.mismatches.some(x=>x.path===target&&x.reason==='MODIFIED'),target);
  }
});
