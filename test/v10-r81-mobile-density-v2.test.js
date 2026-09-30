import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const gate=fs.readFileSync(new URL('../scripts/v10-ui-regression-check.mjs',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r81 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r81');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/MOBILE-DENSITY-V2/);
  assert.equal(manifest.start_url,'./v10/?build=r81&fresh=r81');
  assert.match(html,/10\.0-r81/);
  assert.match(js,/const BUILD='10\.0-r81'/);
});

test('r81 compacts Data State without hiding source semantics',()=>{
  assert.match(css,/@media\(max-width:430px\)[\s\S]*\.data-state-items\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css,/\.data-state-item:only-child,\.data-state-item:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/);
  assert.match(css,/\.data-state-item>small\{font-size:6\.5px;line-height:1\.25\}/);
});

test('r81 keeps Scanner research actions side-by-side with touch-safe targets',()=>{
  assert.match(css,/\.scanner-toolbar-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);width:100%;gap:6px\}/);
  assert.match(css,/\.scanner-toolbar-actions button\{width:auto;min-height:44px;padding:0 7px\}/);
});

test('r81 compacts Bot filters while preserving 44px interaction targets',()=>{
  assert.match(css,/\.bot-filter-bar\{flex-direction:column;align-items:stretch;gap:6px;padding:7px 8px\}/);
  assert.match(css,/\.bot-filter-actions\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:4px\}/);
  assert.match(css,/\.bot-filter-actions button\{min-width:0;min-height:44px;padding:0 4px\}/);
  assert.match(css,/@media\(max-width:390px\)[\s\S]*\.bot-filter-actions\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test('r81 reduces Depot and Bot accordion height without violating touch minimums',()=>{
  assert.match(css,/\.depot-asset-card>summary\{min-height:58px;padding:8px 9px\}/);
  assert.match(css,/\.asset-pair-details>summary\{min-height:60px;padding:8px\}/);
  assert.match(css,/\.asset-toggle-actions button\{min-height:44px;padding:0 7px\}/);
  assert.match(css,/\.command-hub-card\{min-height:52px;padding:7px 8px\}/);
});

test('r81 remains presentation-only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
  assert.match(gate,/r81 permanent mobile-density gates/);
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
