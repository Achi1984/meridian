import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r91 top-fold clarity remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=91,'expected r91 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/COMMAND-TOP-FOLD-CLARITY/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r91+ DATA health stays independent from portfolio authority',()=>{
  const start=js.indexOf('function commandHealthSummary()'),end=js.indexOf('function commandAttentionHtml',start),block=js.slice(start,end);
  assert.match(block,/const dataReady=br\.label==='READY'&&mr\.label==='READY'/);
  assert.match(block,/const portfolio=p\.label==='READY'/);
  assert.doesNotMatch(block,/dataReady=portfolio/);
});

test('r91 collapses verbose source provenance while retaining the source strip',()=>{
  assert.match(js,/function commandDataDisclosure\(\)/);
  assert.match(js,/class="command-source-details command-diagnostics"/);
  assert.match(js,/DATA SOURCES/);
  assert.match(js,/command-source-details-body[^\n]+dataStateStripHtml\('command'\)\+commandDataStrip\(\)/);
  assert.match(js,/source\.innerHTML=commandDataDisclosure\(\)/);
  assert.match(js,/\.command-source-details,\.command-source-strip/);
});

test('r91 source disclosure stays touch-friendly and closed by default',()=>{
  assert.match(css,/\.command-source-details>summary\{[^}]*min-height:44px/);
  const start=js.indexOf('function commandDataDisclosure()');
  const end=js.indexOf('function renderSystemHeader()',start);
  const block=js.slice(start,end);
  assert.doesNotMatch(block,/<details class="command-source-details command-diagnostics" open/);
});
