import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v10=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9css=fs.readFileSync(new URL('../v9/v9.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));

test('r75 release identity is execution-neutral and cache coherent',()=>{
  assert.equal(release.terminalBuild,'10.0-r75');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(release.dashboardShell,/MOBILE-HARDENED$/);
  assert.match(root,/10\.0-r75-production/);
  assert.match(html,/10\.0-r75/);
  assert.match(v10,/const BUILD='10\.0-r75'/);
  assert.equal(manifest.start_url,'./v10/?build=r75&fresh=r75');
});

test('r75 preserves exactly five primary tabs and viewport-fit cover',()=>{
  assert.match(html,/viewport-fit=cover/);
  for(const label of ['COMMAND','DEPOT','BOTS','FORECAST','SCANNER'])assert.match(html,new RegExp('>'+label+'<'));
  assert.equal((html.match(/<button data-v=/g)||[]).length,5);
  assert.doesNotMatch(html,/data-v="paper"|data-v="asset-detail"|data-v="more"/);
});

test('r75 protects all iPhone safe-area edges',()=>{
  assert.match(css,/padding:calc\(7px \+ env\(safe-area-inset-top\)\) calc\(9px \+ env\(safe-area-inset-right\)\) calc\(88px \+ env\(safe-area-inset-bottom\)\) calc\(9px \+ env\(safe-area-inset-left\)\)/);
  assert.match(css,/nav\{padding-left:calc\(7px \+ env\(safe-area-inset-left\)\);padding-right:calc\(7px \+ env\(safe-area-inset-right\)\)\}/);
  assert.match(v9css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.v10-topbar\{top:env\(safe-area-inset-top\)/);
});

test('r75 enforces mobile touch targets for primary and secondary controls',()=>{
  assert.match(css,/nav button\{min-height:48px/);
  assert.match(css,/\.feed-refresh,\.scanner-toolbar button[\s\S]*min-height:44px/);
  assert.match(css,/\.paper-cockpit-toolbar button/);
  assert.match(css,/\.asset-detail-open/);
  assert.match(css,/\.bot-filter-actions button/);
  assert.match(css,/select,input\{min-height:44px\}/);
});

test('r75 exposes keyboard focus without reintroducing motion',()=>{
  assert.match(css,/button:focus-visible,summary:focus-visible,select:focus-visible,input:focus-visible\{outline:2px solid var\(--cyan\);outline-offset:2px\}/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/transition:none!important/);
  assert.match(css,/animation:none!important/);
});

test('r75 prevents page-level horizontal overflow while keeping component scrolling local',()=>{
  assert.match(css,/html,body\{max-width:100%;overflow-x:hidden\}/);
  assert.match(css,/\.v10-shell,\.view,\.v10-mode-banner[\s\S]*min-width:0/);
  assert.match(v9css,/\.venue-line\{display:flex;gap:7px;overflow:auto/);
});

test('r75 gives Loading Stale and Error states a consistent mobile footprint',()=>{
  assert.match(css,/\.v10-live-blocked,\.fib-loading,\.fib-error,\.paper-cockpit-state,\.sk-paper-empty,\.sk-paper-error,\.sk-v2-loading\{overflow-wrap:anywhere\}/);
  assert.match(css,/@media\(max-width:600px\)[\s\S]*\.v10-live-blocked,\.fib-loading,\.fib-error,\.paper-cockpit-state,\.sk-paper-empty,\.sk-paper-error,\.sk-v2-loading\{min-height:58px;padding:10px\}/);
});

test('r75 makes secondary Scanner controls mobile-width without changing behavior',()=>{
  assert.match(css,/\.scanner-toolbar-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);width:100%\}/);
  assert.match(v10,/data-open-paper/);
  assert.match(v10,/data-open-lab/);
  assert.match(v10,/showSecondaryView\('paper','research'\)/);
  assert.match(v10,/showSecondaryView\('more','research'\)/);
});

test('r75 remains presentation/read-only and browser syntax stays valid',()=>{
  assert.doesNotThrow(()=>new Function(v10.replace(/^import .*$/gm,'')));
  assert.equal(release.terminalExecutionImpact,false);
});
