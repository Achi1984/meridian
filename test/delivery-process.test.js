import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync(new URL('../.github/workflows/backend-safety.yml',import.meta.url),'utf8');
test('release safety has one PR trigger, main-only pushes, and cancellation isolated to a PR',()=>{
  const triggers=workflow.slice(workflow.indexOf('on:'),workflow.indexOf('permissions:'));
  assert.match(triggers,/pull_request:\s*\n  push:\s*\n    branches:\s*\n      - main\s*\n/);
  assert.doesNotMatch(triggers,/codex\/|workflow_dispatch|schedule:/);
  assert.match(triggers,/format\('pr-\{0\}', github\.event\.pull_request\.number\)/);
  assert.match(triggers,/format\('run-\{0\}', github\.run_id\)/);
  assert.match(triggers,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow,/run: node --test test\/\*\.test\.js/);
  for(const gate of ['Frozen research lineage','Meridian continuity audit','Public privacy regression','High-confidence secret scan','Assert paper-only invariant'])assert.ok(workflow.includes(gate));
});

function runScenario(advance){
  const code=`
    let calls=0;
    globalThis.fetch=async raw=>{
      const path=new URL(raw).pathname;
      if(path==='/gateway-health'){
        calls++;
        console.log('HEALTH_REQUEST_'+calls);
        return Response.json({deploymentSha:${advance}&&calls>1?'a'.repeat(40):'b'.repeat(40),ok:false});
      }
      console.log('PRODUCT_REQUEST');
      return Response.json({});
    };
    await import(${JSON.stringify(new URL('../scripts/runtime-smoke.mjs',import.meta.url).href)});
  `;
  return spawnSync(process.execPath,['--input-type=module','--eval',code],{
    cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,
    env:{...process.env,GITHUB_SHA:'a'.repeat(40),MERIDIAN_SMOKE_REQUIRE_SHA:'1',MERIDIAN_SMOKE_RETRIES:'2',MERIDIAN_SMOKE_DELAY_MS:'0'}
  });
}
test('old deployed SHA consumes only bounded readiness attempts, never product checks or a success',()=>{
  const result=runScenario(false);
  assert.equal(result.status,1);
  assert.equal((result.stdout.match(/HEALTH_REQUEST_/g)||[]).length,2);
  assert.doesNotMatch(result.stdout,/PRODUCT_REQUEST/);
  assert.match(result.stderr,/attempt 1\/2: DEPLOYMENT_NOT_READY/);
  assert.match(result.stderr,/attempt 2\/2: DEPLOYMENT_NOT_READY/);
  assert.doesNotMatch(result.stderr,/strict gate failed|GitHub Pages stale/);
});
test('matching deployment advances into unchanged acceptance checks and cannot turn a bad product green',()=>{
  const result=runScenario(true);
  assert.equal(result.status,1);
  assert.match(result.stderr,/attempt 1\/2: DEPLOYMENT_NOT_READY/);
  assert.match(result.stdout,/PRODUCT_REQUEST/);
  assert.match(result.stderr,/attempt 2\/2: GitHub Pages stale/);
});
