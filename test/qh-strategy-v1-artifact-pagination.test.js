import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflowUrl=new URL('../.github/workflows/qh-boundary-strategy-v1.yml',import.meta.url);
const scriptUrl=new URL('../scripts/download-github-run-artifacts.sh',import.meta.url);
const workflow=fs.readFileSync(workflowUrl,'utf8');
const script=fs.readFileSync(scriptUrl,'utf8');

test('paginated artifact downloader has valid bash syntax',()=>{
  const path=decodeURIComponent(scriptUrl.pathname);
  const r=spawnSync('bash',['-n',path],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test('artifact downloader paginates and fails closed on count and uniqueness',()=>{
  assert.match(script,/gh api --method GET --paginate/);
  assert.match(script,/artifacts\?per_page=100/);
  assert.match(script,/unique_ids/);
  assert.match(script,/unique_names/);
  assert.match(script,/count=.*wc -l/);
  assert.match(script,/curl -L --fail --silent --show-error/);
  assert.match(script,/download gate failed/);
});

test('Strategy V1 source lock requests exactly 120 frozen V1.3 shard artifacts',()=>{
  assert.match(workflow,/Download all exact Data V1\.3 shard evidence with pagination/);
  assert.match(workflow,/download-github-run-artifacts\.sh 36690368732 qh-v13-shard- 120/);
});

test('Strategy V1 aggregate requests exactly 120 current-run shard artifacts',()=>{
  assert.match(workflow,/Download all Strategy V1 shard artifacts with pagination/);
  assert.match(workflow,/download-github-run-artifacts\.sh "\$GITHUB_RUN_ID" qh-strategy-v1-shard- 120/);
});

test('Strategy V1 does not use pattern listing for the two 120-artifact collections',()=>{
  assert.doesNotMatch(workflow,/pattern: qh-v13-shard-\*/);
  assert.doesNotMatch(workflow,/pattern: qh-strategy-v1-shard-\*/);
});
