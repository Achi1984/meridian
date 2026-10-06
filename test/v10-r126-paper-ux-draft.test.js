import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const visualQa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');

function block(startNeedle,endNeedle,src=js){
  const a=src.indexOf(startNeedle),b=src.indexOf(endNeedle,a+1);
  assert.ok(a>=0&&b>a,'expected source block '+startNeedle);
  return src.slice(a,b);
}

test('r126 draft stays execution-neutral and successor-safe',()=>{
  const m=String(release.terminalBuild||'').match(/^10\\.0-r(\\d+)$/);
  assert.ok(m&&Number(m[1])>=125);
  assert.equal(release.terminalExecutionImpact,false);
});

test('r126 Paper authority note precedes evidence summary without changing safety copy',()=>{
  const cockpit=block('function paperCockpitHtml(){','async function loadPaperCockpit');
  assert.ok(cockpit.indexOf('paper-safety-note')<cockpit.indexOf('paper-summary-grid'));
  for(const token of ['VALIDATION ONLY','bewertet keinen Gewinner','autorisiert keine Promotion oder Live-Ausführung','feste Reihenfolge · keine Performance-Sortierung','liveTrading=false','PAPER ONLY','R42 RESEARCH COHORTS']){
    assert.equal(cockpit.split(token).length-1,1,token);
  }
});

test('r126 preserves fixed non-performance model order',()=>{
  const cockpit=block('function paperCockpitHtml(){','async function loadPaperCockpit');
  const names=['BASELINE 6.2','CHALLENGER V2','CHALLENGER V3','DIRECTIONAL V4','FUNDING CARRY V2'];
  let pos=-1;
  for(const name of names){const next=cockpit.indexOf(name);assert.ok(next>pos,name);pos=next}
  assert.doesNotMatch(cockpit,/models\\.(?:sort|reverse)\\s*\\(/);
});

test('r126 Paper presentation block is view-scoped and keeps trust/action floors',()=>{
  const marker='/* v10 r126 · Paper authority/readability draft (non-release, build remains r125) */';
  const a=css.indexOf(marker);
  assert.ok(a>=0,'R126 CSS marker missing');
  const src=css.slice(a);
  for(const token of ['#view-paper .paper-summary-grid span','#view-paper .paper-safety-note b','#view-paper .paper-safety-note small','#view-paper .paper-cockpit-toolbar button','#view-paper .paper-model-grid b','#view-paper .paper-cohort-grid strong','font-size:9px','font-size:10px','font-size:11px','min-height:44px'])assert.ok(src.includes(token),token);
  assert.doesNotMatch(src,/#view-(?:market|research|asset-detail|command|depot|bots)/);
  assert.doesNotMatch(src,/\\.(?:fib-|sk-|edge-|holdout-|profit-agent-|lab-)/);
  assert.doesNotMatch(src,/!important|display\\s*:\\s*none/);
});

test('r126 Paper builders remain read-only and do not add execution behavior',()=>{
  const src=block('function paperModelCard(m){','async function loadPaperCockpit');
  assert.doesNotMatch(src,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson|executeTrade)/i);
  assert.match(src,/models\\.map\\(paperModelCard\\)/);
});

test('r126 visual QA covers Paper trust states and fail-closed role gates',()=>{
  for(const token of ['paper-stale','paper-error','paper-unavailable','paper-loading','paper-blocked','mobile-375-paper-unavailable','mobile-320-paper-blocked'])assert.ok(visualQa.includes(token),token);
  for(const token of ['smallR126AuthorityText','smallR126PrimaryText','r126TrustClipping','r126PaperFirstViewportInvariant'])assert.ok(js.includes(token),token);
  assert.match(js,/r126ActionSelectors=\['#view-paper \.paper-cockpit-toolbar button'\]/);
  assert.match(js,/r126PaperFirstViewportInvariant/);
});
