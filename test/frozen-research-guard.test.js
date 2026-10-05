import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {FROZEN_RESEARCH_BLOBS,gitBlobSha,verifyFrozenResearch} from '../scripts/frozen-research-guard.mjs';

test('frozen research manifest locks canonical Cross-Venue and Paper Edge lineage',()=>{
  const required=[
    'research/CROSS-VENUE-FUNDING-EDGE-V1-SOURCE-DECISION.md',
    'research/cross-venue-funding-edge-v1-stage-lock.js',
    'test/cross-venue-funding-edge-v1-stage-lock.test.js',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-PREREGISTRATION.md',
    'research/cross-venue-funding-edge-v2-stage-lock.js',
    'test/cross-venue-funding-edge-v2-preregistration.test.js',
    'test/cross-venue-funding-edge-v2-stage-lock.test.js',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-AUTHORIZATION.md',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-EVALUATION.md',
    'research/cross-venue-funding-edge-v2-source-evaluation.json',
    'test/cross-venue-funding-edge-v2-source-evaluation.test.js',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-IMPLEMENTATION.md',
    'research/cross-venue-funding-edge-v2.js',
    'research/cross-venue-funding-edge-v2-data-contract.js',
    'research/cross-venue-funding-edge-v2-ledger.js',
    'research/cross-venue-funding-edge-v2-runner.js',
    'research/cross-venue-funding-edge-v2-source-gate.js',
    'scripts/collect-cross-venue-funding-edge-v2-source.mjs',
    'test/cross-venue-funding-edge-v2.test.js',
    'test/cross-venue-funding-edge-v2-data-contract.test.js',
    'test/cross-venue-funding-edge-v2-ledger.test.js',
    'test/cross-venue-funding-edge-v2-runner.test.js',
    'test/cross-venue-funding-edge-v2-source-gate.test.js',
    'test/cross-venue-funding-edge-v2-collector.test.js',
    '.github/workflows/cross-venue-funding-edge-v2-source.yml',
    'research/PAPER-EDGE-V1-DISCOVERY-DECISION.md',
    'research/paper-edge-v1-discovery-decision.json',
    'research/edge-v1-stage-lock.js',
    'test/edge-v1-stage-lock.test.js'
  ];
  assert.ok(Object.keys(FROZEN_RESEARCH_BLOBS).length>=required.length);
  for(const path of required)assert.ok(path in FROZEN_RESEARCH_BLOBS,path);
  assert.ok('research/paperbot-profit-special-agent-v1.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/paperbot-profit-special-agent-v2.js' in FROZEN_RESEARCH_BLOBS);
  assert.ok('research/PAPERBOT-PROFIT-V2-UPUP-RESULT.md' in FROZEN_RESEARCH_BLOBS);
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


test('guard rejects byte changes to frozen V2 implementation source accounting or workflow files',()=>{
  const targets=[
    'research/CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-AUDIT-EVALUATION.md',
    'research/cross-venue-funding-edge-v2-source-evaluation.json',
    'test/cross-venue-funding-edge-v2-source-evaluation.test.js',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-COVERAGE-EVIDENCE.json',
    'research/CROSS-VENUE-FUNDING-EDGE-V2-IMPLEMENTATION.md',
    'research/cross-venue-funding-edge-v2.js',
    'research/cross-venue-funding-edge-v2-data-contract.js',
    'research/cross-venue-funding-edge-v2-ledger.js',
    'research/cross-venue-funding-edge-v2-runner.js',
    'research/cross-venue-funding-edge-v2-source-gate.js',
    'scripts/collect-cross-venue-funding-edge-v2-source.mjs',
    'test/cross-venue-funding-edge-v2.test.js',
    'test/cross-venue-funding-edge-v2-data-contract.test.js',
    'test/cross-venue-funding-edge-v2-ledger.test.js',
    'test/cross-venue-funding-edge-v2-runner.test.js',
    'test/cross-venue-funding-edge-v2-source-gate.test.js',
    'test/cross-venue-funding-edge-v2-collector.test.js',
    '.github/workflows/cross-venue-funding-edge-v2-source.yml'
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
