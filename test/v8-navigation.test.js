import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const nav=fs.readFileSync(new URL('../app-v8.0-navigation.js',import.meta.url),'utf8');
const more=fs.readFileSync(new URL('../app-v8.0-more-hub.js',import.meta.url),'utf8');
const center=fs.readFileSync(new URL('../app-v8.0-center-summary.js',import.meta.url),'utf8');
const trade=fs.readFileSync(new URL('../app-v8.0-trade-summary.js',import.meta.url),'utf8');
const depot=fs.readFileSync(new URL('../app-v8.0-depot-summary.js',import.meta.url),'utf8');

test('v8 customer navigation contains exactly the five intended top-level items',()=>{
  for(const label of ['CENTER','DEPOT','TRADE','PAPER','MORE']) assert.match(nav,new RegExp(`label:'${label}'`));
  assert.match(nav,/grid-template-columns:repeat\(5/);
});

test('v8 navigation is presentation-only and delegates existing routes',()=>{
  assert.match(nav,/executionImpact:false/);
  assert.match(nav,/legacy\.click\(\)/);
  assert.match(nav,/forceView\(item\)/);
  assert.match(nav,/document\.body\.dataset\.view=item\.runtime/);
  assert.doesNotMatch(nav,/placeOrder|createOrder|submitOrder|liveTrading\s*=\s*true|fetch\([^\n]*(order|trade)/i);
});

test('R11 routes primary tabs to real runtime containers',()=>{
  assert.match(nav,/ids:\['view-center','view-live','view-dashboard'\]/);
  assert.match(nav,/ids:\['view-depot'\]/);
  assert.match(nav,/ids:\['view-daytrade','view-trade'\],runtime:'daytrade'/);
  assert.match(nav,/ids:\['view-paper'\]/);
  assert.match(nav,/v\.classList\.toggle\('hidden',!on\)/);
  assert.match(nav,/removeAttribute\('hidden'\)/);
});

test('R11 Trade summary binds to the real daytrade container first',()=>{
  assert.match(trade,/document\.getElementById\('view-daytrade'\)\|\|document\.getElementById\('view-trade'\)/);
  assert.match(trade,/\['view-daytrade','view-trade'\]\.includes\(r\.id\)/);
  assert.match(trade,/meridian:v8-viewchange/);
});

test('R11 MORE overlay owns active nav state while open',()=>{
  assert.match(nav,/document\.getElementById\('v8-more-overlay'\)\)return 'more'/);
  assert.match(nav,/document\.body\.dataset\.view='more'/);
  assert.match(nav,/markActive\('more'\)/);
});

test('legacy primary bottom navigation is forcibly removed after v8 nav is ready',()=>{
  assert.match(nav,/primaryBottomNav/);
  assert.match(nav,/v8-legacy-bottom-hidden/);
  assert.match(nav,/html\.v8-nav-ready #primaryBottomNav\{display:none!important/);
  assert.match(nav,/safe-area-inset-bottom/);
});

test('Depot details toggle explicitly restores legacy detail children and persists open state',()=>{
  assert.match(depot,/setDetails\(r,open\)/);
  assert.match(depot,/v8-depot-details-open/);
  assert.match(depot,/display','block','important'/);
  assert.match(depot,/const wasOpen=r\.classList\.contains\('v8-depot-details-open'\)/);
  assert.match(depot,/aria-expanded/);
});

test('MORE can route through hidden legacy navigation without clicking its own overlay buttons',()=>{
  assert.match(more,/!el\.closest\?\.\('#v8-more-overlay'\)/);
  assert.match(more,/kind==='market'/);
  assert.match(more,/kind==='forecast'/);
  assert.doesNotMatch(more,/navCandidates\(\)[^\n]*filter\(visible\)/);
});

test('market and forecast detail screens keep MORE active in the five-item nav',()=>{
  assert.match(nav,/market\|forecast\|fcst\|more/);
  assert.match(nav,/return 'more'/);
});

test('CENTER never promotes a non-ready scanner candidate as best opportunity',()=>{
  assert.match(center,/const ready=xs\.filter/);
  assert.match(center,/return ready\.sort/);
  assert.doesNotMatch(center,/ready\.length\?ready:xs/);
  assert.match(center,/NO READY SIGNAL/);
});

test('customer summaries bind only to real view containers, never data-view nav buttons',()=>{
  assert.match(trade,/document\.getElementById\('view-daytrade'\)/);
  assert.match(depot,/document\.getElementById\('view-depot'\)/);
  assert.doesNotMatch(trade,/querySelector\('\[data-view="trade"\]'\)/);
  assert.doesNotMatch(depot,/querySelector\('\[data-view="depot"\]'\)/);
  assert.doesNotMatch(center,/querySelector\('\[data-view=/);
});

test('Trade and Center prefer canonical live bot state over empty bootstrap snapshots',()=>{
  assert.match(trade,/canonicalBotStates/);
  assert.match(center,/canonicalBotStates/);
  assert.match(trade,/CANONICAL_BOT_STATES/);
  assert.match(center,/btcRegime/);
});
