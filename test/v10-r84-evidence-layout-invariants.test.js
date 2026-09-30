import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const qa=fs.readFileSync(new URL('../scripts/v10-visual-qa.mjs',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r84 evidence-layout contract remains active on successor builds',()=>{
  const m=String(release.terminalBuild||'').match(/^10\.0-r(\d+)$/);
  assert.ok(m&&Number(m[1])>=84,'expected r84 or successor terminal build');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/EVIDENCE-LAYOUT-INVARIANTS/);
  const rev='r'+m[1];
  assert.equal(manifest.start_url,'./v10/?build='+rev+'&fresh='+rev);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r84 visual QA makes Scanner action layout an explicit pass/fail invariant',()=>{
  assert.match(js,/const scannerActionsSameRow=/);
  assert.match(js,/layout=\{scannerActionsSameRow(?:,|\})/);
  assert.match(js,/report\.ok=viewportMatch&&layout\.scannerActionsSameRow/);
});

test('r84 Scanner actions are locked to a two-column mobile grid',()=>{
  assert.match(css,/#view-research \.scanner-toolbar-actions\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;width:100%!important/);
  assert.match(css,/#view-research \.scanner-toolbar-actions>button\{width:100%!important;min-width:0!important;min-height:44px!important/);
});

test('r84 deterministic account fixture is fresh enough to exercise LIVE position UI',()=>{
  assert.match(js,/pionexAccount=\{updatedAt:new Date\(now\)\.toISOString\(\),snapshotAt:new Date\(now\)\.toISOString\(\),walletStatus:'OK'/);
  assert.match(js,/side:'LONG',leverage:3,markPrice:1\.15,avgPrice:1\.12,liquidationPrice:\.66/);
});

test('r84 visual runner follows current terminal revision instead of hardcoding r83',()=>{
  assert.match(qa,/const release=JSON\.parse\(fs\.readFileSync\(path\.join\(ROOT,'version\.json'\),'utf8'\)\),revision='r'/);
  assert.match(qa,/url\.searchParams\.set\('build',revision\)/);
  assert.doesNotMatch(qa,/set\('build','r83'\)/);
});

test('r84 remains presentation and QA only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(gate,/r84 permanent evidence-layout gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
