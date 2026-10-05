import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildFibLevels,adjacentFibLevels} from '../v10/fib-core.js';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
const html=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');

function loadNearestHarness(){
  const a=js.indexOf('function fibNearestContext(');
  const b=js.indexOf('function fibAutoNear(',a);
  assert.ok(a>=0&&b>a,'r115 nearest FIB helper must be present');
  const block=js.slice(a,b);
  return new Function('adjacentFibLevels',`
    ${block}
    return fibNearestContext;
  `)(adjacentFibLevels);
}

test('r115 release identity is coherent and execution neutral',()=>{
  assert.equal(release.terminalBuild,'10.0-r115');
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/NEAREST-FIB-AUTO-SYNC/);
  assert.equal(manifest.start_url,'./v10/?build=r115&fresh=r115');
  assert.match(html,/meridian-build" content="10\.0-r115"/);
  assert.ok(js.includes("const BUILD='10.0-r115'"));
});

test('r115 reproduces the INJ screenshot and selects the true nearest AUTO FIB',()=>{
  const fibNearestContext=loadNearestHarness();
  const levels=buildFibLevels(7.124,8.675,'DOWN');
  const current=7.509;
  const next=adjacentFibLevels(levels,current);
  const near=fibNearestContext(levels,current);

  assert.equal(next.above?.ratio,0.382);
  assert.ok(Math.abs(Number(next.above?.price)-7.716482)<1e-9);
  assert.equal(next.below?.ratio,0.236);
  assert.ok(Math.abs(Number(next.below?.price)-7.490036)<1e-9);

  assert.deepEqual(near,{f:0.236,price:7.490036});
  assert.ok(Math.abs((near.price-current)/current*100)<1);
});

test('r115 Forecast Focus prefers fresh AUTO FIB context and keeps legacy feed fallback',()=>{
  const a=js.indexOf('function opportunityContext(symbol)');
  const b=js.indexOf('function forecastContextHtml(',a);
  const block=js.slice(a,b);
  assert.match(block,/const near=fibAutoNear\(symbol\)\|\|i\.near/);
  assert.match(block,/nearPrice=Number\(near\?\.price\)/);
  assert.match(block,/nearRatio=Number\(near\?\.f\)/);
  assert.match(block,/Nahe relevantem FIB-Level/);
});

test('r115 AUTO context is fail-closed, fresh-only and MANUAL cannot feed Opportunity Quality',()=>{
  const a=js.indexOf('function fibAutoNear(');
  const b=js.indexOf('function opportunityContext(',a);
  const helper=js.slice(a,b);
  const u=js.indexOf('async function updateFibMap(');
  const v=js.indexOf('function refreshForecastFocus(',u);
  const update=js.slice(u,v);

  assert.match(helper,/ctx\.mode!=='AUTO'/);
  assert.match(helper,/!freshTs\(ctx\.loadedAt\)/);
  assert.match(update,/fibAutoContext\.delete\(String\(fibUi\.symbol/);
  assert.match(update,/fibUi\.mode==='AUTO'\?fibNearestContext\(levels,current\):null/);
  assert.match(update,/if\(autoNear\)fibAutoContext\.set/);
  assert.doesNotMatch(update,/mode:'MANUAL'.*fibAutoContext\.set/s);
});

test('r115 refreshes Forecast Focus only after FIB calculation settles',()=>{
  const a=js.indexOf('async function updateFibMap(');
  const b=js.indexOf('function refreshForecastFocus(',a);
  const block=js.slice(a,b);
  assert.match(block,/finally\{out\.setAttribute\('aria-busy','false'\);refreshForecastFocus\(view\)\}/);
});

test('r115 nearest-FIB bridge remains presentation/context only',()=>{
  const a=js.indexOf('function fibNearestContext(');
  const b=js.indexOf('function marketRow(',a);
  const block=js.slice(a,b);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|method:\s*['"]POST|postJson)/i);
});
