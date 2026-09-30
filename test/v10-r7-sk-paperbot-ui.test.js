import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../research/sk-paperbot-v1.js',import.meta.url),'utf8');
const v9=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

test('v10 r13 exposes SK PaperBot V1 as LAB-only research',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(js,/SK PAPERBOT V1/);
  assert.match(js,/SEQUENCE BOT · CORE/);
  assert.match(js,/PAPER ONLY/);
  assert.match(js,/SK BACKTEST STARTEN/);
  assert.match(js,/RESEARCH GATE/);
  assert.match(js,/KEINE AUTO-PROMOTION/);
});

test('SK V1 uses paged historical 4h bridge instead of live private bot data',()=>{
  assert.match(v9,/async function marketKlinesHistory/);
  assert.match(v9,/Math\.min\(9000/);
  assert.match(v9,/guard\+\+<12/);
  assert.match(v9,/limit=Math\.min\(1000,want-out\.length\)/);
  assert.match(v9,/signalTone,marketKlines,marketKlinesHistory/);
  assert.match(js,/H\(\)\.marketKlinesHistory/);
  assert.match(js,/loader\('4h',bars,skLabUi\.symbol\)/);
});

test('SK V1 UI reports state, costs, double advantage and chronological windows',()=>{
  for(const token of ['CURRENT STATE','DOUBLE ADV','5 ZEITFENSTER','Gebühren + Slippage aktiv','Doppelter Vorteil wird gemessen']){
    assert.ok(js.includes(token),`missing UI token: ${token}`);
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


test('v10 r13 browser adapter is syntactically valid after removing ESM imports',()=>{
  const body=js.replace(/^import .*$/gm,'');
  assert.doesNotThrow(()=>new Function(body));
});

test('v10 r13 LAB renderer is unique and contains SK panel wiring',()=>{
  assert.equal((js.match(/function renderLab\(\)/g)||[]).length,1);
  assert.equal((js.match(/function skPaperPanel\(\)/g)||[]).length,1);
  assert.match(js,/bindSkPaper\(view\)/);
  assert.match(js,/class="sk-paper-shell"/);
});


test('v10 r13 cache key is unique across production entrypoints',()=>{
  const root=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const shell=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
  const legacy=fs.readFileSync(new URL('../v9/index.html',import.meta.url),'utf8');
  const engine=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
  for(const txt of [root,shell,legacy,engine,js]){
    assert.doesNotMatch(txt,/(?:10\.0-r(?:7|8))(?!\d)|build=r(?:7|8)(?!\d)|build','r(?:7|8)(?!\d)/);
  }
  assert.match(root,/build=r\d+/);
  assert.match(shell,/v10\.js\?v=10\.0-r\d+/);
  assert.match(shell,/v9\.js\?v=10\.0-r\d+/);
  assert.match(js,/fib-core\.js\?v=10\.0-r\d+/);
  assert.match(js,/sk-paperbot-v1\.js\?v=10\.0-r\d+/);
  assert.match(js,/sk-research-v2\.js\?v=10\.0-r\d+/);
});


test('SK Research V2 exposes frozen A/B multi-asset controls',()=>{
  for(const token of ['SK RESEARCH V2','CORE vs DOUBLE ADVANTAGE','365 TAGE','730 TAGE','1460 TAGE','V2 MULTI-ASSET STARTEN','V2 FROZEN GATE']){
    assert.ok(js.includes(token),`missing V2 UI token: ${token}`);
  }
  for(const asset of ['BTC','ETH','SOL','XRP','HBAR','LINK','AVAX','SUI']){
    assert.ok(js.includes(asset),`missing V2 asset: ${asset}`);
  }
  assert.match(css,/\.sk-v2-shell/);
  assert.match(css,/\.sk-v2-assets/);
});

test('LAB separates SK System Lab from collapsed Profit Lock Lab',()=>{
  assert.match(js,/sk-system-module/);
  assert.match(js,/module\.open=true/);
  assert.match(js,/profit-lock-module/);
  assert.match(js,/PROFIT LOCK LAB/);
  assert.match(js,/SK SYSTEM LAB/);
  assert.match(css,/\.research-module/);
});

test('V2 batch remains click-to-run research only and sequential',()=>{
  assert.match(js,/async function runSkV2Batch/);
  assert.match(js,/for\(const symbol of SK_RESEARCH_V2_ASSETS\)/);
  assert.match(js,/await loader\('4h',bars,symbol\)/);
  assert.match(js,/await new Promise\(resolve=>setTimeout\(resolve,120\)\)/);
  assert.match(js,/Same-Bar-OHLC zählt nicht/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});
