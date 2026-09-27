import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const v9html=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const version=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r15 separates safety-ready from decision-ready bot state',()=>{
  assert.match(js,/safetyReady/);
  assert.match(js,/decisionReady/);
  assert.match(js,/SAFETY READY/);
  assert.match(js,/DECISION READY/);
  assert.match(js,/SAFETY ONLY/);
  assert.match(js,/decisionRows=safetyRows\.filter/);
  assert.match(js,/intelFresh\(s\?\.assetIntel\?\.\[b\.symbol\]\)/);
});

test('r15 keeps safety visible while blocking stale-market profit decisions',()=>{
  assert.match(js,/if\(!g\.safetyReady\)return/);
  assert.match(js,/decisionRows=rows\.filter/);
  assert.match(js,/g\.decisionReady\?watch\+' \/ '\+lock:'— \/ —'/);
  assert.match(js,/MARKET_STALE/);
  assert.match(js,/KEINE AKTION · DATEN PRÜFEN/);
});

test('r15 data guard no longer calls safety-only data actionable',()=>{
  assert.match(js,/label=g\.decisionReady>0\?\(g\.coverageComplete\?'DECISION READY':'PARTIAL READY'\):g\.safetyReady>0\?'SAFETY ONLY':'BLOCKED'/);
  assert.match(js,/actionable=decisionReady/);
  assert.doesNotMatch(js,/g\.actionable>0\?'ACTIONABLE'/);
});

test('r15 legacy v9 bot cards do not label unknown COIN-M investment as USD',()=>{
  assert.match(v9,/function botInvestLabel\(b\)/);
  assert.match(v9,/liveInvestUsdAvailable\(b\).*CAPITAL USD/);
  assert.match(v9,/INVEST RAW/);
  assert.match(v9,/GESAMTPROFIT USD/);
  assert.doesNotMatch(v9,/<span>INVEST<\/span><b>\$\{b\.invest==null\?'—':money\(b\.invest\)\}/);
});

test('r15 mobile layouts account for expanded readiness fields',()=>{
  assert.match(css,/bot-tab-head\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  assert.match(css,/v10-live-overview\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\}/);
  assert.match(css,/@media\(max-width:430px\)/);
});

test('r15+ release identity stays consistent across production and legacy entrypoints',()=>{
  const build=String(version.terminalBuild||''),rev=build.split('-').at(-1);
  assert.match(build,/^10\.0-r\d+$/);
  assert.ok(shell.includes(build));
  assert.ok(root.includes('build='+rev));
  assert.ok(v9html.includes("p.set('build','"+rev+"')"));
  assert.ok(v9.includes("qs.set('build','"+rev+"')"));
  assert.ok(js.includes("const BUILD='"+build+"'"));
});

test('r15 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
