import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../.github/workflows/qh-boundary-strategy-v1.yml',import.meta.url),'utf8');

test('Strategy V1 source lock explicitly paginates all Data V1.3 artifacts',()=>{
  assert.match(workflow,/Download all exact Data V1\.3 shard evidence with pagination/);
  assert.match(workflow,/gh api --method GET --paginate/);
  assert.match(workflow,/actions\/runs\/36690368732\/artifacts\?per_page=100/);
  assert.match(workflow,/startsWith\("qh-v13-shard-"\)/);
  assert.match(workflow,/test "\$count" = "120"/);
});

test('Strategy V1 aggregate explicitly paginates all 120 current-run shard artifacts',()=>{
  assert.match(workflow,/Download all Strategy V1 shard artifacts with pagination/);
  assert.match(workflow,/actions\/runs\/\$\{GITHUB_RUN_ID\}\/artifacts\?per_page=100/);
  assert.match(workflow,/startsWith\("qh-strategy-v1-shard-"\)/);
  const exact120=(workflow.match(/test "\$count" = "120"/g)||[]).length;
  assert.equal(exact120,2);
});

test('Strategy V1 no longer relies on cross-run download-artifact pattern listing for V1.3 shards',()=>{
  assert.doesNotMatch(workflow,/pattern: qh-v13-shard-\*/);
  assert.doesNotMatch(workflow,/pattern: qh-strategy-v1-shard-\*/);
});
