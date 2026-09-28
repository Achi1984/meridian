import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r40 unmatched diagnostics expose only resolution metadata',()=>{
  const block=v10.slice(v10.indexOf('function unmatchedDiagnostics('),v10.indexOf('function dataGuardCard'));
  assert.match(block,/S\(\)\?\.unmatchedLive\|\|\[\]/);
  assert.match(block,/symbol/);
  assert.match(block,/side/);
  assert.match(block,/leverage/);
  assert.match(block,/AMBIGUOUS MATCH/);
  assert.match(block,/NO CONFIDENT MATCH/);
  assert.match(block,/PNL ✓/);
  assert.match(block,/USD CAPITAL ✓/);
  assert.match(block,/keine Bot-ID oder privaten Beträge/);
  assert.doesNotMatch(block,/x\?\.id|x\.id/);
});

test('r40 COMMAND and BOTS reuse the same unmatched diagnostics renderer',()=>{
  const guard=v10.slice(v10.indexOf('function dataGuardCard'),v10.indexOf('function liveOverview'));
  assert.match(guard,/unmatchedDiagnostics\(\)/);
  const bots=v10.slice(v10.indexOf('function renderBots'),v10.indexOf('function marketUniverse'));
  assert.match(bots,/unmatchedOpen=force\?\$\('\.v10-unmatched-details',view\)\?\.open:null/);
  assert.match(bots,/unmatchedDiagnostics\(unmatchedOpen\?\?false\)/);
  assert.match(bots,/UNVERIFIED und aus Actions ausgeschlossen/);
});

test('r40 compact diagnostic styling exists for desktop and mobile',()=>{
  assert.match(css,/\.v10-unmatched-details\{/);
  assert.match(css,/\.unmatched-list\{/);
  assert.match(css,/\.unmatched-row\{/);
  assert.match(css,/@media\(max-width:600px\)\{\.unmatched-row/);
});

test('r40 preserves global and per-asset fail-closed decision guards',()=>{
  const next=v10.slice(v10.indexOf('function nextAction(){'),v10.indexOf('function syncHealth(){'));
  assert.match(next,/if\(!g\.coverageComplete\)return\{title:'KEINE AKTION · DATEN PRÜFEN'/);
  const pair=v10.slice(v10.indexOf('function pairStatus(symbol){'),v10.indexOf('function exposure(rows,side)'));
  assert.match(pair,/if\(unmatchedAsset\.length\)return\{code:'UNVERIFIED'/);
  assert.ok(pair.indexOf("if(hardProtection)")<pair.indexOf("if(unmatchedAsset.length)"));
  assert.ok(pair.indexOf("min!=null&&min<10")<pair.indexOf("if(unmatchedAsset.length)"));
});

test('r40 keeps trading thresholds and execution neutral',()=>{
  const plan=v9.slice(v9.indexOf('function profitLockPlan'),v9.indexOf('function topProfitPlan'));
  for(const token of ["pnl>=20","pnl>=12","pnl>=10","pnl>=8","pnl>=3"])assert.ok(plan.includes(token),token);
  assert.match(v9,/hedgePct<15/);
  assert.equal(release.terminalBuild,'10.0-r40');
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
