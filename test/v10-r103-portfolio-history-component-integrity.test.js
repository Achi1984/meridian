import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../portfolio-history-store.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r103 release identity is cache coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r103');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PORTFOLIO-HISTORY-COMPONENT-INTEGRITY/);
  assert.equal(release.dashboardConsistency,'7.64-CANONICAL-PORTFOLIO-HISTORY-V2');
  assert.equal(manifest.start_url,'./v10/?build=r103&fresh=r103');
  assert.ok(js.includes("const BUILD='10.0-r103'"));
});

test('r103 history writer requires both strict Spot authority and Pionex equity authority',()=>{
  assert.match(store,/spotAuthorityComplete=base\?\.spotAuthority\?\.complete===true/);
  assert.match(store,/tradingAuthorityComplete=tradingAuthority\?\.found===true/);
  assert.match(store,/authorityComplete=spotAuthorityComplete&&tradingAuthorityComplete/);
  assert.match(store,/sourceStatus:\{\.\.\.base\.sourceStatus,trading:tradingAuthorityComplete\?'PIONEX_EQUITY':'MISSING'\}/);
});

test('r103 reader retains audit rows but excludes incomplete canonical points from chart data',()=>{
  assert.match(store,/export function canonicalHistoryPointComplete\(point=\{\}\)/);
  assert.match(store,/spotStatus==='STRICT_AUTHORITY'&&tradingStatus==='PIONEX_EQUITY'/);
  assert.match(store,/const normalized=normalizeHistoryRows\(r\.rows\|\|\[\]\),points=normalized\.filter\(canonicalHistoryPointComplete\),excludedIncompletePoints=normalized\.length-points\.length/);
  assert.match(store,/rawPointCount:normalized\.length,excludedIncompletePoints,points/);
});

test('r103 UI independently rejects legacy rows missing Pionex equity authority',()=>{
  assert.match(js,/String\(x\?\.sourceStatus\?\.spot\|\|''\)==='STRICT_AUTHORITY'&&String\(x\?\.sourceStatus\?\.trading\|\|''\)==='PIONEX_EQUITY'/);
  assert.match(js,/excludedIncompletePoints/);
  assert.match(js,/SPOT \+ PIONEX/);
  assert.match(js,/BLOCKED/);
});

test('r103 does not synthesize or mutate historical values',()=>{
  assert.doesNotMatch(store+js,/interpolat|syntheticPortfolioHistory|backfillFakeHistory/i);
  assert.doesNotMatch(js,/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/);
});
