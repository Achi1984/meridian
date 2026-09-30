import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const gateway=fs.readFileSync(new URL('../server-gateway.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r69 release identity is canonical and execution-neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r69');
  assert.equal(release.terminalExecutionImpact,false);
  assert.equal(release.dashboardShell,'10.0-r69-COMMAND-DEPOT-SHELL');
  assert.match(root,/10\.0-r69-production/);
  assert.match(html,/10\.0-r69/);
  assert.match(v10,/const BUILD='10\.0-r69'/);
});

test('r69 exposes exactly five primary decision tabs plus a secondary Lab',()=>{
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.match(html,/id="view-depot"/);
  assert.doesNotMatch(html,/data-v="more"/);
  assert.match(v10,/data-open-lab/);
  assert.match(v10,/data-lab-back/);
  assert.match(v10,/showSecondaryView\('more','research'\)/);
});

test('r69 Command Center prioritizes wealth change risk freshness and attention',()=>{
  assert.match(v10,/function commandOverviewHtml\(\)/);
  assert.match(v10,/GESAMTVERMÖGEN/);
  assert.match(v10,/24H Δ/);
  assert.match(v10,/7T Δ/);
  assert.match(v10,/RISK STATUS/);
  assert.match(v10,/DATA FRESHNESS/);
  assert.match(v10,/maximal drei Punkte/);
  assert.match(css,/\.command-kpi-grid/);
  assert.match(css,/\.command-attention/);
});

test('r69 Depot uses canonical venue total and keeps detail rows non-additive',()=>{
  assert.match(v10,/function renderDepot\(force=false\)/);
  assert.match(v10,/CANONICAL VENUE TOTAL/);
  assert.match(v10,/ACCOUNTING GUARD/);
  assert.match(v10,/nicht doppelt addiert/);
  assert.match(v10,/ledgerAssets/);
  assert.match(v10,/pionexDetailAssets/);
  assert.match(v10,/Bot-Exposure wird im BOTS-Tab bewertet und nicht zum Depotwert addiert/);
  assert.match(v10,/new Set\(\$\$\('\.depot-asset-card\[open\]'/);
  assert.match(css,/\.depot-venue-grid/);
  assert.match(css,/\.depot-asset-card/);
});

test('r69 refresh control delegates to the existing read-only bridge',()=>{
  assert.match(html,/id="refresh-feeds"/);
  assert.match(v10,/function refreshFeeds\(\)/);
  assert.match(v10,/bridge\(\)\?\.refreshNow\?\.\(\)/);
  assert.match(v9,/refreshNow:\(\)=>refreshNow\(\)/);
});

test('r69 loads a full week of canonical portfolio history for 24h and 7d comparisons',()=>{
  assert.match(v9,/portfolio-history\?range=1w/);
  assert.doesNotMatch(v9,/portfolio-history\?range=1d/);
  assert.match(gateway,/portfolio-history[\s\S]*limit:2200/);
  assert.match(v10,/historyDelta\(24\*60\*60\*1000\)/);
  assert.match(v10,/historyDelta\(7\*24\*60\*60\*1000\)/);
});

test('r69 carries Ledger asset details without changing portfolio authority',()=>{
  assert.match(v9,/holdingUsd/);
  assert.match(v9,/const ledgerAssets=ledgerAuto\.active/);
  assert.match(v9,/ledgerAutoAuthorityAt:ledgerAuto\.authorityAt,ledgerAssets/);
  assert.match(v9,/authorityMode:'STRICT_VENUE_SNAPSHOT'/);
});

test('r69 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
});
