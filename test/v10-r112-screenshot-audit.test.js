import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../v10/v10.css',import.meta.url),'utf8');
const release=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));

test('r112 release identity is coherent and execution neutral',()=>{
  assert.match(release.terminalBuild,/^10\.0-r\d+$/);
  assert.ok(Number(release.terminalBuild.split('r').at(-1))>=112);
  assert.equal(release.terminalExecutionImpact,false);
  assert.match(String(release.dashboardShell||''),/FIB-ZONE-SIGNAL-SEPARATION-MOBILE-FIB-DECONFLICTION/);
  assert.ok(js.includes("const BUILD='"+release.terminalBuild+"'"));
});

test('r112 separates FIB price zones from directional forecast semantics',()=>{
  assert.match(js,/LEVEL MAP · KEIN RICHTUNGSSIGNAL/);
  assert.match(js,/POTENZIELLE LONG-REAKTIONSZONE · LEVEL ONLY/);
  assert.match(js,/POTENZIELLE SHORT-REAKTIONSZONE · LEVEL ONLY/);
  assert.match(js,/FORECAST-\/Momentum-Richtung bleibt davon getrennt/);
  assert.doesNotMatch(js,/LONG TRENDWENDE · BULLISH/);
  assert.doesNotMatch(js,/SHORT TRENDWENDE · BEARISH/);
});

test('r112 mobile FIB ladder suppresses colliding non-adjacent SK labels',()=>{
  assert.match(css,/v10 r112 · screenshot audit/);
  assert.match(css,/\.fib-zone span\{display:none\}/);
  assert.match(css,/\.fib-sk-core:not\(\.fib-next-up\):not\(\.fib-next-down\) span\{visibility:hidden\}/);
  assert.match(css,/\.fib-ladder\{height:430px\}/);
});

test('r112 remains presentation-only',()=>{
  const a=js.indexOf('function fibSkCards'),b=js.indexOf('async function updateFibMap',a),block=js.slice(a,b);
  assert.doesNotMatch(block,/(?:submitOrder|placeOrder|createOrder|cancelOrder|transferFunds|postJson)/i);
});
