import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../research/tsmom-holdout-v1.js',import.meta.url),'utf8');
const protocol=fs.readFileSync(new URL('../research/TSMOM-HOLDOUT-V1-FROZEN.md',import.meta.url),'utf8');

test('r11 exposes TSMOM Holdout V1 inside Documented Edge Lab',()=>{
  assert.match(html,/10\.0-r\d+/);
  assert.match(js,/TSMOM HOLDOUT V1/);
  assert.match(js,/INDEPENDENT VALIDATION/);
  assert.match(js,/TSMOM HOLDOUT STARTEN/);
  assert.match(js,/COMBINED HOLDOUT/);
  assert.match(css,/\.holdout-shell/);
  assert.match(css,/\.holdout-combined/);
});

test('r11 holdout freezes old-time and transfer universes before results',()=>{
  assert.match(engine,/Date\.UTC\(2020,4,1\)/);
  assert.match(engine,/Date\.UTC\(2022,6,31/);
  for(const asset of ['BNB','ADA','DOGE','DOT','XLM','TRX','LTC','BCH']) assert.match(engine,new RegExp("'"+asset+"'"));
  assert.match(protocol,/2020-05-01 through 2022-07-31/);
  assert.match(protocol,/No parameter is changed after the discovery result/);
});

test('r11 holdout keeps original TSMOM parameters and same frozen gate',()=>{
  assert.match(engine,/runTsmomClassic\(dataset\)/);
  assert.match(engine,/evaluateTsmomGate\(summary,stability,assets/);
  assert.match(protocol,/30 \/ 90 \/ 365 day trend directions/);
  assert.match(protocol,/rebalance every 30 days/);
  assert.match(protocol,/10% annualized per-market volatility target/);
  assert.match(protocol,/8 bps modeled exposure-turnover cost/);
});

test('r11 holdout requires both independent validations and full transfer breadth',()=>{
  assert.match(engine,/LEGACY_GATE_FAIL/);
  assert.match(engine,/TRANSFER_GATE_FAIL/);
  assert.match(engine,/LEGACY_DATA_BREADTH_LT_4/);
  assert.match(engine,/TRANSFER_DATA_BREADTH_LT_8/);
  assert.match(engine,/HOLDOUT_PASS/);
  assert.match(engine,/autoPromotion:false/);
});

test('r11 holdout UI reports long short exposure and cost diagnostics without gating on them',()=>{
  for(const token of ['LONG CONTRIB','SHORT CONTRIB','LONG / SHORT SIGNAL','AVG EXPOSURE','AVG LEVERAGE','COST / |GROSS|']){
    assert.ok(js.includes(token),`missing diagnostic token: ${token}`);
  }
  assert.match(engine,/longContributionPct/);
  assert.match(engine,/shortContributionPct/);
  assert.match(engine,/modeledCostVsGrossAbsPct/);
  assert.match(protocol,/Diagnostics only/);
});

test('r11 holdout loads public daily history sequentially and never submits orders',()=>{
  assert.match(js,/for\(const symbol of DOCUMENTED_EDGE_ASSETS\)/);
  assert.match(js,/loader\('1d',2800,symbol\)/);
  assert.match(js,/for\(const symbol of TSMOM_TRANSFER_ASSETS\)/);
  assert.match(js,/loader\('1d',1860,symbol\)/);
  assert.match(js,/await new Promise\(resolve=>setTimeout\(resolve,120\)\)/);
  assert.doesNotMatch(engine,/submitOrder|placeOrder|createOrder/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('r11 browser adapter remains syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(js.replace(/^import .*$/gm,'')));
});
