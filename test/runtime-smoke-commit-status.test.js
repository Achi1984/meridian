import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../.github/workflows/runtime-smoke.yml',import.meta.url),'utf8');

test('runtime smoke can publish a commit status without private credentials',()=>{
  assert.match(workflow,/permissions:\n  contents: read\n  statuses: write/);
  assert.match(workflow,/context "meridian\/runtime-smoke"/);
  assert.match(workflow,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow,/secrets\.MERIDIAN_READ_TOKEN/);
  assert.doesNotMatch(workflow,/MERIDIAN_READ_TOKEN:\s*\$\{\{/);
});

test('runtime smoke reports pending then final result for the workflow commit',()=>{
  assert.match(workflow,/Publish runtime smoke pending/);
  assert.match(workflow,/state "pending"/);
  assert.match(workflow,/id: runtime_smoke/);
  assert.match(workflow,/continue-on-error: true/);
  assert.match(workflow,/Publish runtime smoke result/);
  assert.match(workflow,/if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow,/SMOKE_OUTCOME: \$\{\{ steps\.runtime_smoke\.outcome \}\}/);
  assert.match(workflow,/state="success"/);
  assert.match(workflow,/state="failure"/);
  assert.match(workflow,/statuses\/\$\{GITHUB_SHA\}/);
});

test('runtime smoke status links back to the exact Actions run and still fails the workflow on smoke failure',()=>{
  assert.match(workflow,/actions\/runs\/\$\{GITHUB_RUN_ID\}/);
  assert.match(workflow,/Preserve runtime smoke failure semantics/);
  assert.match(workflow,/if: \$\{\{ steps\.runtime_smoke\.outcome != 'success' \}\}/);
  assert.match(workflow,/run: exit 1/);
});


test('runtime smoke requires the exact deployed workflow SHA by default',()=>{
  const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');
  assert.match(workflow,/MERIDIAN_SMOKE_REQUIRE_SHA: '1'/);
  assert.match(smoke,/const REQUIRE_SHA=!!EXPECTED_SHA&&process\.env\.MERIDIAN_SMOKE_REQUIRE_SHA!=='0'/);
  assert.match(smoke,/if\(REQUIRE_SHA&&sha\.shaMatch!==true\)fail\(/);
  assert.match(smoke,/Deployment SHA mismatch/);
});

test('runtime smoke surfaces the safe OKX authority configuration boolean',()=>{
  const smoke=fs.readFileSync(new URL('../scripts/runtime-smoke.mjs',import.meta.url),'utf8');
  assert.match(smoke,/okxPortfolioAuthorityConfigured:health\.okxPortfolioAuthorityConfigured===true/);
});
