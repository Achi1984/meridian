import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r67 renders live assets as collapsible risk-first cards',()=>{
  assert.match(v10,/function pairCard\(symbol,compact=false,open=false,assetLink=false,decisionView=false\)/);
  assert.match(v10,/<details class="asset-pair asset-pair-details pair-tone-/);
  assert.match(v10,/data-symbol="/);
  assert.match(v10,/asset-glance/);
  assert.match(v10,/PNL <b class="tone-/);
  assert.match(v10,/MIN LIQ/);
  assert.match(v10,/HEDGE/);
  assert.match(v10,/pairStatus\(b\)\.rank-pairStatus\(a\)\.rank/);
});

test('r67 manual-open-state contract remains while r98 successor defaults assets closed',()=>{
  assert.match(v10,/hadAssetAccordion=!!\$\('\.asset-pair-details',view\)/);
  assert.match(v10,/openAssets=new Set/);
  assert.match(v10,/hadAssetAccordion\?openAssets\.has\(symbol\):false/);
  assert.doesNotMatch(v10,/hadAssetAccordion\?openAssets\.has\(symbol\):symbol===criticalSymbol/);
});

test('r67 hides low-value diagnostics behind one technical details disclosure',()=>{
  assert.match(v10,/class="v10-bot-diagnostics"/);
  assert.match(v10,/TECHNISCHE DETAILS/);
  assert.match(v10,/Account API · Wallet Discovery · Normalizer · historische Referenz/);
  assert.match(v10,/accountPositionLayer\(false\)\+walletDiscoveryLayer\(\)/);
  assert.match(v10,/RAW API TREND/);
});

test('r67 provides expand and collapse controls for the asset list',()=>{
  assert.match(v10,/data-assets-action="close">ALLE ZU/);
  assert.match(v10,/data-assets-action="open">ALLE AUF/);
  assert.match(v10,/function bindBotOverviewControls\(view\)/);
  assert.match(v10,/x\.open=open/);
});

test('r67 keeps compact command risk cards while simplifying the BOTS view',()=>{
  assert.match(v10,/decisionClass=decisionView\?' command-risk-card pair-tone-'\+st\.tone:''/);
  assert.match(v10,/return '<article class="asset-pair pair-compact'\+decisionClass/);
  assert.match(v10,/command-risk-card/);
  assert.match(v10,/pair-tone-/);
  assert.match(v10,/BOT CONTROL CENTER/);
  assert.match(v10,/Risk-first Übersicht · Details nur bei Bedarf öffnen/);
  assert.match(css,/\.asset-pair-details>summary/);
  assert.match(css,/\.asset-accordion-stack\{display:grid;grid-template-columns:1fr/);
});

test('r67 is presentation-only and execution-neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.equal(release.terminalExecutionImpact,false);
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
