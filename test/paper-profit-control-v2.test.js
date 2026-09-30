import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('r90 Paper Profit Control V2 Stage A is research-only and fail-closed',()=>{
  const doc=fs.readFileSync('research/PAPERBOT-PROFIT-CONTROL-V2.md','utf8');
  for(const marker of [
    'Execution impact: **false**',
    'Auto-promotion: **forbidden**',
    'RUNTIME / FORWARD',
    'HISTORICAL / HOLDOUT',
    'maximum allowed drawdown',
    'PAPER_PROFIT_CONTROL_V2_STAGE_A_PASS_NUMERIC_GATES_REQUIRED'
  ]) assert.ok(doc.includes(marker),marker);
});

test('r90 observer capture is read-only and forbids promotion semantics',()=>{
  const src=fs.readFileSync('scripts/capture-paper-bot-observer-r90.mjs','utf8');
  assert.ok(src.includes('/api/bot-observer?audit='));
  assert.ok(src.includes("liveTrading!==false"));
  assert.ok(src.includes("paperTrading!==true"));
  assert.ok(src.includes("rankingAuthorized:false"));
  assert.ok(src.includes("promotionAuthorized:false"));
  assert.equal(/POST|PUT|PATCH|DELETE/.test(src),false);
});

test('legacy v8 Paper scorer is explicitly non-authoritative',()=>{
  const src=fs.readFileSync('app-v8.0-paper-summary.js','utf8');
  assert.ok(src.includes('LEGACY NON-AUTHORITATIVE'));
  assert.ok(src.includes('WATCH/WATCH+'));
});
