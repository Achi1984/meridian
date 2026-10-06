import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const draft=fs.readFileSync(new URL('../docs/r125-forecast-scanner-draft.md',import.meta.url),'utf8');
const marker='/* MERIDIAN R125 · Forecast + Scanner decision hierarchy */';
const start=css.indexOf(marker);
const r125=start>=0?css.slice(start):'';

test('r125 draft remains non-release and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r124');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(draft,/DRAFT ONLY/);
  assert.match(draft,/Merge today: FORBIDDEN/);
});

test('r125 Forecast trust text uses the 9px role floor',()=>{
  assert.ok(start>=0,'R125 CSS marker missing');
  assert.match(r125,/#view-market \.data-state-item>small,[\s\S]*font-size:9px/);
  assert.match(r125,/#view-market \.forecast-focus-head small,[\s\S]*font-size:9px/);
  assert.match(r125,/#view-market \.forecast-focus-grid>span,[\s\S]*font-size:9px/);
  assert.match(r125,/#view-market \.forecast-context-note,[\s\S]*font-size:9px/);
});

test('r125 Scanner trust/action roles meet 9/10/11 and 44px floors',()=>{
  assert.match(r125,/#view-research \.data-state-item>small,[\s\S]*font-size:9px/);
  assert.match(r125,/#view-research \.scanner-summary span,[\s\S]*font-size:9px/);
  assert.match(r125,/#view-research \.scanner-summary b\{[\s\S]*font-size:11px/);
  assert.match(r125,/#view-research \.scanner-toolbar-actions button,[\s\S]*min-height:44px;[\s\S]*font-size:10px/);
  assert.match(r125,/#view-research \.scanner-leader \.scan-forecast-open,[\s\S]*min-height:44px;[\s\S]*font-size:10px/);
});

test('r125 core does not leak into Paper, Asset Detail, research rules or global typography',()=>{
  for(const token of ['#view-paper','#view-asset-detail','.fib-','.sk-','.edge-','.holdout-','.profit-agent-','.lab-']){
    assert.equal(r125.includes(token),false,'unexpected R125 scope token: '+token);
  }
  assert.doesNotMatch(r125,/!important/);
  assert.doesNotMatch(r125,/(?:^|\n)\s*(?:html|body|\*)\s*\{[^}]*font-size\s*:/m);
});
