import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Existing Release Safety discovers test/*.test.js. Keep the synthetic integrated
// publisher suites in that path without installing a sender or changing workflows.
test('inactive publisher host integration: synthetic adapters and failure paths', {timeout:120000}, t => {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const prefix='docs/autonomy/event-adapter/review-binding/test/';
 const suites=['publication-reservation-receipt.test.mjs','publication-host.test.mjs',
  'publication-recovery.test.mjs','publication-run-preflight.test.mjs',
  'publication-plan-process.test.mjs','publication-oidc.test.mjs',
  'publication-service.test.mjs','publication-actions-identity.test.mjs',
  'publication-actions-pools.test.mjs','publication-actions-bootstrap.test.mjs',
  'publication-actions-test-runner.test.mjs','publication-database-readiness.test.mjs'];
 const childEnv={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
 // Do not inherit the parent's Node test-worker context into a fresh test runner.
 delete childEnv.NODE_TEST_CONTEXT;
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...suites.map(name=>prefix+name)],{
  cwd:root,encoding:'utf8',timeout:110000,maxBuffer:1024*1024,
  env:childEnv
 });
 assert.ifError(run.error);
 assert.equal(run.status,0,`Synthetic publisher integration failed:\n${run.stdout}\n${run.stderr}`);
 const total=name=>{
  const matches=[...run.stdout.matchAll(new RegExp('^# '+name+' (\\d+)\\r?$','gm'))];
  assert.equal(matches.length,1,`Expected one TAP ${name} total`);
  return Number(matches[0][1]);
 };
 const tests=total('tests');
 assert.ok(tests>=190,`Expected all integrated suites (at least 190 tests), received ${tests}`);
 assert.equal(total('pass'),tests);
 for(const name of ['fail','cancelled','skipped','todo'])assert.equal(total(name),0);
 t.diagnostic(run.stdout.split('\n').filter(line=>/^# (tests|pass|fail|skipped) /.test(line)).join('; '));
});


