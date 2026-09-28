import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalRevision,releaseBranchRevision,assessReleasePr,staleReleasePrNumbers} from '../scripts/release-coordinator.mjs';

test('release coordinator parses only canonical terminal release identities',()=>{
  assert.equal(terminalRevision('10.0-r37'),37);
  assert.equal(terminalRevision('9.0-r37'),null);
  assert.equal(releaseBranchRevision('fix/v10-r38-okx-provenance'),38);
  assert.equal(releaseBranchRevision('chore/agent-release-coordinator-v1'),null);
});

test('non-release PR may keep current terminal build but may not change it',()=>{
  assert.equal(assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r37',branch:'chore/process',currentPrNumber:210}).ok,true);
  const bad=assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r38',branch:'chore/process',currentPrNumber:210});
  assert.equal(bad.ok,false);
  assert.match(bad.reason,/outside a v10-rNN release branch/);
});

test('release PR must be exactly main plus one and branch/build must agree',()=>{
  assert.equal(assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r38',branch:'fix/v10-r38-foo',currentPrNumber:211}).ok,true);
  assert.equal(assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r39',branch:'fix/v10-r39-foo',currentPrNumber:211}).ok,false);
  assert.equal(assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r38',branch:'fix/v10-r39-foo',currentPrNumber:211}).ok,false);
  assert.equal(assessReleasePr({mainBuild:'10.0-r38',candidateBuild:'10.0-r38',branch:'fix/v10-r38-foo',currentPrNumber:211}).ok,false);
});

test('oldest open PR owns the release lease',()=>{
  const open=[
    {number:210,state:'open',head:{ref:'fix/v10-r38-first'}},
    {number:211,state:'open',head:{ref:'fix/v10-r38-second'}}
  ];
  const second=assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r38',branch:'fix/v10-r38-second',currentPrNumber:211,openPrs:open});
  assert.equal(second.ok,false);
  assert.match(second.reason,/owned by older open PR #210/);
  const first=assessReleasePr({mainBuild:'10.0-r37',candidateBuild:'10.0-r38',branch:'fix/v10-r38-first',currentPrNumber:210,openPrs:open});
  assert.equal(first.ok,true);
});

test('main sweep closes only stale release branches, not infrastructure or future release branches',()=>{
  const open=[
    {number:201,state:'open',head:{ref:'fix/v10-r36-old'}},
    {number:202,state:'open',head:{ref:'fix/v10-r37-old'}},
    {number:203,state:'open',head:{ref:'fix/v10-r38-next'}},
    {number:204,state:'open',head:{ref:'chore/process'}}
  ];
  assert.deepEqual(staleReleasePrNumbers('10.0-r37',open),[201,202]);
});
