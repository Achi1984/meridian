import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../research/sk-paperbot-v1.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('v10 r7 exposes SK PaperBot V1 as LAB-only research',()=>{
  assert.match(html,/10\.0-r7/);
  assert.match(js,/SK PAPERBOT V1/);
  assert.match(js,/SEQUENCE BOT · CORE/);
  assert.match(js,/PAPER ONLY/);
  assert.match(js,/SK BACKTEST STARTEN/);
  assert.match(js,/RESEARCH GATE/);
  assert.match(js,/KEINE AUTO-PROMOTION/);
});

test('SK V1 uses paged historical 4h bridge instead of live private bot data',()=>{
  assert.match(v9,/async function marketKlinesHistory/);
  assert.match(v9,/limit=Math\.min\(1000,want-out\.length\)/);
  assert.match(v9,/signalTone,marketKlines,marketKlinesHistory/);
  assert.match(js,/H\(\)\.marketKlinesHistory/);
  assert.match(js,/loader\('4h',bars,skLabUi\.symbol\)/);
});

test('SK V1 UI reports state, costs, double advantage and chronological windows',()=>{
  for(const token of ['CURRENT STATE','DOUBLE ADV','5 ZEITFENSTER','Gebühren + Slippage aktiv','Doppelter Vorteil wird gemessen']){
    assert.match(js,new RegExp(token));
  }
  assert.match(css,/\.sk-paper-shell/);
  assert.match(css,/\.sk-window-grid/);
});

test('SK V1 engine remains non-executing and non-promoting',()=>{
  assert.match(engine,/researchOnly:true/);
  assert.match(engine,/executionImpact:false/);
  assert.match(engine,/autoPromotion:false/);
  assert.doesNotMatch(engine,/submitOrder|placeOrder|createOrder|LIVE_TRADING/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('SK V1 freezes gate, entries, targets, invalidation and total risk',()=>{
  assert.match(engine,/gateRatio:\.382/);
  assert.match(engine,/entryRatios:Object\.freeze\(\[\.5,\.559,\.618,\.667\]\)/);
  assert.match(engine,/targetRatios:Object\.freeze\(\[1\.618,1\.809,2\]\)/);
  assert.match(engine,/exitReason='ORIGIN_INVALIDATION'/);
  assert.match(engine,/riskPct:1/);
});
