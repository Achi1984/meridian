import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v0=fs.readFileSync(new URL('../.github/workflows/quarter-hour-boundary-imbalance-v1-data-v0.yml',import.meta.url),'utf8');
const v1=fs.readFileSync(new URL('../.github/workflows/quarter-hour-boundary-imbalance-v1-data-v1.yml',import.meta.url),'utf8');

test('retired QH Data V0 does not rerun on resume-only changes',()=>{
  assert.doesNotMatch(v0,/MERIDIAN_RESUME\.json/);
  assert.match(v0,/workflow_dispatch:/);
});

test('retired QH Data V1 does not rerun canaries on resume-only changes',()=>{
  assert.doesNotMatch(v1,/MERIDIAN_RESUME\.json/);
  assert.match(v1,/PERPETUAL-QUARTER-HOUR-BOUNDARY-IMBALANCE-V1-DATA-V1\.md/);
  assert.match(v1,/workflow_dispatch:/);
});
