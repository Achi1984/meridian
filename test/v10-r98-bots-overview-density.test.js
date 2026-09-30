import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r98 Bots overview-density contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=98,'expected r98 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/BOTS-OVERVIEW-DENSITY/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r98 bot asset cards start closed and preserve explicit open state',()=>{
  const start=js.indexOf('function renderBots(force=false)'),end=js.indexOf('function marketUniverse()',start),block=js.slice(start,end);
  assert.match(block,/liveCards=syms\.map\(symbol=>pairCard\(symbol,false,hadAssetAccordion\?openAssets\.has\(symbol\):false,true\)\)/);
  assert.doesNotMatch(block,/symbol===criticalSymbol/);
  assert.match(block,/openAssets=new Set\(\[\.\.\.view\.querySelectorAll\('\.asset-pair-details\[open\]'\)\]\.map/);
});

test('r98 keeps risk-first ordering and surfaces filter counts without new scoring',()=>{
  const start=js.indexOf('function renderBots(force=false)'),end=js.indexOf('function marketUniverse()',start),block=js.slice(start,end);
  assert.match(block,/sort\(\(a,b\)=>pairStatus\(b\)\.rank-pairStatus\(a\)\.rank/);
  assert.match(block,/riskCount=allSyms\.filter\(symbol=>botFilterMatch\(symbol,'RISK'\)\)\.length/);
  assert.match(block,/profitCount=allSyms\.filter\(symbol=>botFilterMatch\(symbol,'PROFIT'\)\)\.length/);
  assert.match(block,/hedgeCount=allSyms\.filter\(symbol=>botFilterMatch\(symbol,'HEDGE'\)\)\.length/);
  assert.match(block,/RISIKO '\+riskCount\+' · PROFIT '\+profitCount\+' · HEDGE '\+hedgeCount/);
});

test('r98 keeps closed cards decision-useful',()=>{
  const start=js.indexOf('function pairCard('),end=js.indexOf('function criticalPair()',start),block=js.slice(start,end);
  for(const token of ['PNL <b','MIN LIQ <b','HEDGE <b','RANGE <b'])assert.ok(block.includes(token),token);
  assert.match(block,/pair-status tone-/);
  assert.match(block,/asset-pair-identity/);
});

test('r98 preserves fail-visible technical diagnostics',()=>{
  const start=js.indexOf('function renderBots(force=false)'),end=js.indexOf('function marketUniverse()',start),block=js.slice(start,end);
  assert.match(block,/diagnosticsOpen=diagOpenExisting\?\?\(!healthy\|\|!ph\.fresh\|\|unmatched>0\)/);
  assert.match(block,/accountPositionLayer\(false\)\+walletDiscoveryLayer\(\)\+assetWatchShareCard\(\)/);
  assert.match(block,/UNVERIFIED/);
});

test('r98 compacts Bots health filters and asset rows on mobile',()=>{
  assert.match(css,/#view-bots \.data-state-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#view-bots \.bot-tab-head-compact/);
  assert.match(css,/#view-bots \.asset-pair-details>summary\{min-height:60px/);
  assert.match(css,/#view-bots \.bot-filter-actions\{width:100%;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('r98 remains presentation-only',()=>{
  const start=js.indexOf('function botFilterMatch('),end=js.indexOf('function marketUniverse()',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});
