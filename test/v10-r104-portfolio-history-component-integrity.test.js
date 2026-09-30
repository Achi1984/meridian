import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../portfolio-history-store.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r104 contract remains cache coherent and execution neutral on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=104);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/PORTFOLIO-HISTORY-COMPONENT-INTEGRITY/);
  assert.match(String(release.dashboardConsistency||''),/^7\.64-CANONICAL-PORTFOLIO-HISTORY-V\d+$/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r104 history writer requires both strict Spot authority and Pionex equity authority',()=>{
  assert.match(store,/spotAuthorityComplete=base\?\.spotAuthority\?\.complete===true/);
  assert.match(store,/tradingAuthorityComplete=tradingAuthority\?\.found===true/);
  assert.match(store,/authorityComplete=spotAuthorityComplete&&tradingAuthorityComplete/);
  assert.match(store,/sourceStatus:\{\.\.\.base\.sourceStatus,trading:tradingAuthorityComplete\?'PIONEX_EQUITY':'MISSING'\}/);
});

test('r104 reader keeps audit evidence but excludes incomplete canonical points',()=>{
  assert.match(store,/export function canonicalHistoryPointComplete\(point=\{\}\)/);
  assert.match(store,/spotStatus==='STRICT_AUTHORITY'&&tradingStatus==='PIONEX_EQUITY'/);
  assert.match(store,/points=normalized\.filter\(canonicalHistoryPointComplete\),excludedIncompletePoints=normalized\.length-points\.length/);
  assert.match(store,/rawPointCount:normalized\.length,excludedIncompletePoints,points/);
});

test('r104 UI independently rejects missing Pionex authority and reports blocked legacy points',()=>{
  assert.match(js,/portfolioHistoryTradingAuthorityFresh/);
  assert.match(js,/excludedIncompletePoints/);
  assert.match(js,/STRICT HISTORY/);
  assert.match(js,/BLOCKED/);
});

test('r104 does not fabricate history or alter trading execution',()=>{
  assert.doesNotMatch(store+js,/syntheticPortfolioHistory|interpolatePortfolioHistory|backfillFakeHistory/i);
  assert.doesNotMatch(js,/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/);
});
