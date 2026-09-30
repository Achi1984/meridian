import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r101 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r101');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/MOBILE-SHELL-DENSITY/);
  assert.equal(manifest.start_url,'./v10/?build=r101&fresh=r101');
  assert.ok(js.includes("const BUILD='10.0-r101'"));
  assert.match(html,/v10 r101 · SMART TRADING TERMINAL/);
});

test('r101 compacts the sticky mobile header while retaining explicit live status',()=>{
  assert.match(css,/\/\* v10 r101 · global mobile shell density \*\/[\s\S]*@media\(max-width:600px\)/);
  assert.match(css,/\.v10-topbar\{[\s\S]*margin:0 -1px 5px;[\s\S]*padding:5px 2px 6px;[\s\S]*min-height:54px/);
  assert.match(css,/\.system-status\{[\s\S]*grid-template-columns:repeat\(2,auto\)/);
  assert.match(html,/id="market-status"/);
  assert.match(html,/id="data-status"/);
});

test('r101 keeps refresh as a 44px icon touch target instead of spending width on label text',()=>{
  assert.match(css,/\.feed-refresh\{[\s\S]*width:44px;[\s\S]*min-width:44px;[\s\S]*min-height:44px/);
  assert.match(css,/\.feed-refresh span\{display:none\}/);
  assert.match(html,/id="refresh-feeds"[^>]*aria-label="Feeds aktualisieren"/);
});

test('r101 reduces repeated mode-banner chrome without hiding its explanatory copy',()=>{
  assert.match(css,/\.v10-mode-banner\{[\s\S]*margin-bottom:7px;[\s\S]*padding:6px 8px/);
  assert.match(css,/\.v10-mode-banner small\{font-size:6\.5px;line-height:1\.25\}/);
  assert.doesNotMatch(css,/\.v10-mode-banner small\{[^}]*display:none/);
});

test('r101 keeps bottom navigation safe and adds a non-layout-shifting active cue',()=>{
  assert.match(css,/nav\{[\s\S]*padding-bottom:calc\(5px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/nav button\{[\s\S]*min-height:48px/);
  assert.match(css,/nav button\.active::before\{[\s\S]*position:absolute;[\s\S]*height:2px/);
  assert.match(css,/#nav button\{min-height:44px/);
});

test('r101 preserves the narrow fallback and all five primary tabs',()=>{
  assert.match(css,/@media\(max-width:350px\)\{[\s\S]*\.system-status\{grid-template-columns:1fr\}/);
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
});

test('r101 remains presentation-only',()=>{
  const forbidden=/(?:submitOrder|placeOrder|createOrder|cancelOrder|\/trade\/order|method\s*:\s*['"]POST['"])/;
  assert.doesNotMatch(js,forbidden);
});
