import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../research/documented-edge-v1.js',import.meta.url),'utf8');
const protocol=fs.readFileSync(new URL('../research/DOCUMENTED-EDGE-LAB-V1-FROZEN.md',import.meta.url),'utf8');

test('r10 promotes Documented Edge Lab to primary research module',()=>{
  assert.match(html,/10\.0-r10/);
  assert.match(js,/DOCUMENTED EDGE LAB/);
  assert.match(js,/PRIMARY LAB/);
  assert.match(js,/PUBLISHED STRATEGY REPLICATIONS/);
  assert.match(js,/TSMOM CLASSIC/);
  assert.match(js,/DELTA-NEUTRAL EVIDENCE/);
  assert.match(js,/3W PRICE-SORT/);
  assert.match(css,/\.documented-edge-shell/);
  assert.match(css,/\.documented-edge-module/);
});

test('r10 TSMOM uses frozen documented mechanics and no live execution',()=>{
  assert.match(engine,/lookbacks:Object\.freeze\(\[30,90,365\]\)/);
  assert.match(engine,/rebalanceDays:30/);
  assert.match(engine,/volLookbackDays:60/);
  assert.match(engine,/targetVolAnnual:\.10/);
  assert.match(engine,/maxLeverage:2/);
  assert.match(engine,/costBps:8/);
  assert.match(js,/runTsmomClassic\(data\)/);
  assert.doesNotMatch(engine,/submitOrder|placeOrder|createOrder/);
  assert.doesNotMatch(js,/submitOrder|placeOrder|createOrder/);
});

test('r10 Cross-Sectional Momentum is visibly proxy-only until market-cap history exists',()=>{
  assert.match(engine,/formationDays:21/);
  assert.match(engine,/skipDays:1/);
  assert.match(engine,/rebalanceDays:7/);
  assert.match(engine,/exactReplication:false/);
  assert.match(engine,/EXACT_FACTOR_REQUIRES_HISTORICAL_MARKET_CAP/);
  assert.match(js,/PROXY ONLY/);
  assert.match(js,/historische Market-Cap-Gewichtung/);
  assert.match(protocol,/exact replication requires a separate historical market-cap data source/i);
});

test('r10 Funding Carry reuses frozen existing status and cannot silently reopen entries',()=>{
  assert.match(engine,/FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED/);
  assert.match(engine,/newEntriesAllowed:FUNDING_CARRY_V2_NEW_ENTRIES_ALLOWED/);
  assert.match(js,/NEW ENTRIES OFF/);
  assert.match(protocol,/Funding Carry V2 new entries are disabled/);
});

test('r10 SK remains a separate frozen benchmark and Profit Lock remains collapsed',()=>{
  assert.match(js,/SK SYSTEM LAB/);
  assert.match(js,/eingefroren/);
  assert.match(js,/PROFIT LOCK LAB/);
  assert.match(js,/profit-lock-module/);
  const render=js.slice(js.indexOf('function renderLab(){'),js.indexOf('function decorate(){'));
  assert.match(render,/documented-edge-module/);
  assert.match(render,/module\.open=true/);
});

test('r10 edge batch is click-to-run, sequential and public-data only',()=>{
  assert.match(js,/async function runDocumentedEdgeBatch/);
  assert.match(js,/for\(const symbol of DOCUMENTED_EDGE_ASSETS\)/);
  assert.match(js,/await loader\('1d',bars,symbol\)/);
  assert.match(js,/await new Promise\(resolve=>setTimeout\(resolve,120\)\)/);
  assert.match(js,/EDGE BATCH STARTEN/);
});

test('r10 browser adapter remains syntactically valid',()=>{
  const body=js.replace(/^import .*$/gm,'');
  assert.doesNotThrow(()=>new Function(body));
});
