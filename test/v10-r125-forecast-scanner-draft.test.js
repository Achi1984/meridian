import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const draft=fs.readFileSync(new URL('../docs/r125-forecast-scanner-draft.md',import.meta.url),'utf8');
const v10js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const visualQa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
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


test('r125 visual QA contract covers Forecast and Scanner roles',()=>{
  for(const selector of [
    '#view-market .forecast-focus-head small',
    '#view-market .forecast-focus-grid>span',
    '#view-research .scanner-summary span',
    '#view-research .scanner-leader-note',
    '#view-research .scanner-toolbar small'
  ]) assert.ok(v10js.includes(selector),'missing R125 trust selector '+selector);

  for(const selector of [
    '#view-research .scanner-toolbar-actions button',
    '#view-research .scanner-leader .scan-forecast-open',
    '#view-research .scanner-leader .asset-detail-open'
  ]) assert.ok(v10js.includes(selector),'missing R125 strict action selector '+selector);

  assert.match(v10js,/r125FirstActionInvariant/);
  assert.match(v10js,/smallR125PrimaryText/);
  assert.match(v10js,/r125TrustClipping/);
});

test('r125 mobile stress matrix includes Forecast and Scanner stale error paths',()=>{
  for(const name of [
    'mobile-375-forecast-stale',
    'mobile-375-scanner-stale',
    'mobile-375-scanner-error',
    'mobile-320-forecast-stale',
    'mobile-320-scanner-stale',
    'mobile-320-scanner-error'
  ]) assert.ok(visualQa.includes(name),'missing visual QA case '+name);
});


test('r125 Scanner leader reorder preserves actions, confluence and ranking semantics',()=>{
  const leaderStart=v10js.indexOf('function scannerLeaderCard(symbol){');
  const cardStart=v10js.indexOf('function scannerCard(symbol){',leaderStart);
  const renderStart=v10js.indexOf('function renderScanner(force=false){',cardStart);
  const skStart=v10js.indexOf('function skNum(',renderStart);
  assert.ok(leaderStart>=0&&cardStart>leaderStart&&renderStart>cardStart&&skStart>renderStart);
  const leader=v10js.slice(leaderStart,cardStart);
  const card=v10js.slice(cardStart,renderStart);
  const render=v10js.slice(renderStart,skStart);

  const head=leader.indexOf('scanner-leader-head');
  const grid=leader.indexOf('scanner-leader-grid');
  const note=leader.indexOf('scanner-leader-note');
  const actions=leader.indexOf('scan-drill-actions');
  const confluence=leader.indexOf('scannerConfluenceHtml(symbol)');
  assert.ok(head>=0&&head<grid&&grid<note&&note<actions&&actions<confluence);

  assert.equal((leader.match(/scan-drill-actions/g)||[]).length,1);
  assert.equal((leader.match(/data-forecast-asset/g)||[]).length,1);
  assert.equal((leader.match(/<button/g)||[]).length,1);
  assert.equal((leader.match(/addEventListener/g)||[]).length,0);
  assert.equal((leader.match(/onclick/g)||[]).length,0);
  assert.ok(leader.includes("assetDetailButton(symbol,'ASSET DETAIL')"));
  assert.ok(leader.includes('IM FORECAST ÖFFNEN'));
  assert.ok(v10js.includes('FRESH CONTEXT REQUIRED'));

  assert.ok(card.includes(`const open='<div class="scan-drill-actions">`));
  assert.ok(card.includes('data-forecast-asset'));
  assert.match(render,/return B\.score-A\.score\|\|sb\.rank-sa\.rank\|\|sb\.score-sa\.score/);
});
