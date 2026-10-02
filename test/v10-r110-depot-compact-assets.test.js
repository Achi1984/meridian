import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r110 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r110');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/DEPOT-COMPACT-COLLAPSED-ASSET-ROWS/);
  assert.equal(manifest.start_url,'./v10/?build=r110&fresh=r110');
  assert.ok(js.includes("const BUILD='10.0-r110'"));
});

test('r110 collapsed Depot row contains only wallet and bot glance metrics',()=>{
  const start=js.indexOf('function depotAssetCard(row,open=false)'),end=js.indexOf('// Legacy r69 semantic contract',start),block=js.slice(start,end);
  const summary=block.slice(block.indexOf('<summary>'),block.indexOf('</summary>'));
  assert.match(summary,/<span>WALLET <b>/);
  assert.match(summary,/<span>BOTS <b>/);
  assert.doesNotMatch(summary,/<span>ANTEIL <b>/);
  assert.match(block,/class="depot-share-row"><span>ANTEIL<\/span>/);
  assert.match(block,/nur bei vollständiger Portfolio Authority/);
});

test('r110 mobile collapsed rows stay single-line and materially shorter',()=>{
  assert.match(css,/#view-depot \.depot-asset-card>summary\{grid-template-columns:minmax\(92px,1fr\) auto auto;min-height:52px/);
  assert.match(css,/@media\(max-width:430px\)[\s\S]*#view-depot \.depot-asset-card>summary\{grid-template-columns:minmax\(86px,1fr\) auto auto;min-height:48px/);
  assert.match(css,/#view-depot \.depot-asset-glance\{grid-column:auto;grid-row:auto;display:flex/);
});

test('r110 preserves open-state, details and bot-exposure separation',()=>{
  const start=js.indexOf('function renderDepot(force=false)'),end=js.indexOf('function showSecondaryView',start),block=js.slice(start,end);
  assert.match(block,/openAssets\.has\(row\.symbol\)/);
  assert.match(js,/Bot-Exposure wird im BOTS-Tab bewertet und nicht zum Depotwert addiert/);
  assert.match(js,/WALLET DETAIL/);
  assert.match(js,/precisePrice\(mp\.value\)/);
});

test('r110 remains presentation-only',()=>{
  const start=js.indexOf('function depotAssetCard(row,open=false)'),end=js.indexOf('// Legacy r69 semantic contract',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson)/i);
});
