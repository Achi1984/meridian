import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Stage A evidence is frozen, provenance-linked and non-promotional',()=>{
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-CONTROL-V2-STAGE-A-EVIDENCE.md','utf8');
  for(const marker of [
    '36741184819 — SUCCESS',
    '11110602473',
    'sha256:a01be5b716cd678c7dc8c445f370fe0f827f404dabff89569672cbca0776239e',
    'paperTrading: **true**',
    'liveTrading: **false**',
    'Promotion authorized: **false**',
    'Ranking authorized: **false**',
    'PAPER_PROFIT_CONTROL_V2_STAGE_A_PASS_NUMERIC_GATES_REQUIRED'
  ]) assert.ok(doc.includes(marker),marker);
});
