import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r91 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r91');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-TOP-FOLD-CLARITY/);
  assert.equal(manifest.start_url,'./v10/?build=r91&fresh=r91');
  assert.ok(js.includes("const BUILD='10.0-r91'"));
});

test('r91 LIVE DATA freshness is independent from incomplete portfolio authority',()=>{
  assert.match(js,/portfolioReady=p\.complete===true,feedReady=g\.decisionComplete&&m\.coverageComplete/);
  assert.match(js,/<span>LIVE DATA<\/span>/);
  assert.doesNotMatch(js,/dataReady=portfolioReady&&g\.decisionComplete&&m\.coverageComplete/);
});

test('r91 collapses verbose source provenance while retaining the source strip',()=>{
  assert.match(js,/function commandDataDisclosure\(\)/);
  assert.match(js,/class="command-source-details"/);
  assert.match(js,/DATA SOURCES/);
  assert.ok(js.includes("+commandDataStrip()+'</details>'"));
  assert.match(js,/source\.innerHTML=commandDataDisclosure\(\)/);
  assert.match(js,/\.command-source-details,\.command-source-strip/);
});

test('r91 source disclosure stays touch-friendly and closed by default',()=>{
  assert.match(css,/\.command-source-details>summary\{[^}]*min-height:44px/);
  const start=js.indexOf('function commandDataDisclosure()');
  const end=js.indexOf('function renderSystemHeader()',start);
  const block=js.slice(start,end);
  assert.doesNotMatch(block,/<details class="command-source-details" open/);
});
