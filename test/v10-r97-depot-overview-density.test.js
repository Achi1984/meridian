import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r97 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r97');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/DEPOT-OVERVIEW-DENSITY/);
  assert.equal(manifest.start_url,'./v10/?build=r97&fresh=r97');
  assert.ok(js.includes("const BUILD='10.0-r97'"));
});

test('r97 Depot leads with canonical total and authoritative venue provenance',()=>{
  const start=js.indexOf('function renderDepot(force=false)'),end=js.indexOf('function showSecondaryView',start),block=js.slice(start,end);
  assert.match(block,/GESAMTPORTFOLIO/);
  assert.match(block,/KANONISCHER VENUE-TOTAL/);
  assert.match(block,/SERVER_PORTFOLIO_AUTHORITY/);
  assert.match(block,/SERVER AUTH/);
  assert.match(block,/ledgerAutoAgeMs/);
  assert.match(block,/pionexAgeMs/);
});

test('r97 accounting explanation is collapsed while keeping the invariant visible',()=>{
  const start=js.indexOf('function renderDepot(force=false)'),end=js.indexOf('function showSecondaryView',start),block=js.slice(start,end);
  assert.match(block,/class="depot-accounting-details"/);
  assert.match(block,/ACCOUNTING GUARD/);
  assert.match(block,/KEIN DOUBLE COUNTING/);
  assert.doesNotMatch(block,/<details class="depot-accounting-details" open/);
  assert.match(css,/\.depot-accounting-details>summary\{[^}]*min-height:44px/);
});

test('r97 asset accordions default closed and preserve explicit open state on rerender',()=>{
  const start=js.indexOf('function renderDepot(force=false)'),end=js.indexOf('function showSecondaryView',start),block=js.slice(start,end);
  assert.match(block,/rows\.map\(row=>depotAssetCard\(row,had\?openAssets\.has\(row\.symbol\):false\)\)/);
  assert.doesNotMatch(block,/i===0/);
});

test('r97 keeps Depot health dense on mobile without removing source status',()=>{
  assert.match(css,/#view-depot \.data-state-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#view-depot \.data-state-item>small\{font-size:6\.5px/);
  assert.match(css,/#view-depot \.depot-asset-card>summary\{min-height:58px/);
});

test('r97 remains presentation-only',()=>{
  const start=js.indexOf('function depotAssetRows()'),end=js.indexOf('function showSecondaryView',start),block=js.slice(start,end);
  assert.doesNotMatch(block,/submitOrder|placeOrder|createOrder|cancelOrder|postJson|method:\s*['"]POST|\/trade\/order/);
});
