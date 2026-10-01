import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r107 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r107');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/MARKET-COVERAGE-DIAGNOSTICS/);
  assert.equal(manifest.start_url,'./v10/?build=r107&fresh=r107');
  assert.ok(v10.includes("const BUILD='10.0-r107'"));
});

test('r107 market health exposes concrete fresh, stale, and missing symbol sets',()=>{
  assert.match(v10,/freshSymbols=rows\.filter\(x=>intelFresh\(x\.intel\)\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/knownSymbols=rows\.filter\(x=>!!x\.intel\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/staleSymbols=rows\.filter\(x=>!!x\.intel&&!intelFresh\(x\.intel\)\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/missingSymbols=rows\.filter\(x=>!x\.intel\)\.map\(x=>x\.symbol\)/);
  assert.match(v10,/freshSymbols,knownSymbols,staleSymbols,missingSymbols/);
});

test('r107 diagnostics disclose blocker symbols without forcing the disclosure open',()=>{
  assert.match(v10,/function compactMarketSymbols\(rows=\[\],limit=6\)/);
  assert.match(v10,/function marketCoverageIssueText\(m\)/);
  assert.match(v10,/STALE '\+compactMarketSymbols\(m\.staleSymbols\)/);
  assert.match(v10,/MISSING '\+compactMarketSymbols\(m\.missingSymbols\)/);
  assert.match(v10,/command-source-details/);
  assert.match(v10,/coverage=marketCoverageIssueText\(m\)/);
  assert.match(v10,/SYNC '\+esc\(m\.syncStatus\)/);
});

test('r107 keeps market readiness and safety semantics unchanged',()=>{
  assert.match(v10,/if\(m\.syncing\)return\{label:'SYNCING',tone:'watch'\}/);
  assert.match(v10,/if\(m\.fresh&&m\.coverageComplete\)return\{label:'READY',tone:'safe'\}/);
  assert.match(v10,/if\(m\.fresh\)return\{label:'PARTIAL',tone:'watch'\}/);
  assert.match(v10,/return\{label:'STALE',tone:'watch'\}/);
  assert.match(v10,/if\(g\.safetyReady>0\)return\{label:'SAFETY',tone:'watch'\}/);
  assert.doesNotMatch(v10,/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/);
});
