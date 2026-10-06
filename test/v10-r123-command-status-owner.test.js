import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper=fs.readFileSync(new URL('../v10/r123-command-status-owner.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../v10/index.html',import.meta.url),'utf8');
const js=fs.readFileSync(new URL('../v10/v10.js',import.meta.url),'utf8');
const build=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8')).terminalBuild;

function block(a,b){const i=js.indexOf(a),j=js.indexOf(b,i+1);assert.ok(i>=0&&j>i,'expected '+a);return js.slice(i,j)}

test('r123 loads after validated v10 and r122 layout',()=>{
  const core=index.indexOf('./v10.js?v='+build);
  const layout=index.indexOf('./r122-command-layout.js?v='+build);
  const owner=index.indexOf('./r123-command-status-owner.js?v='+build);
  assert.ok(core>=0&&layout>core&&owner>layout);
});

test('r123 reduces exactly three rendered health facts to one worst-tone owner',()=>{
  assert.match(helper,/chips\.length===3/);
  assert.match(helper,/rank=\{danger:4,watch:3,muted:2,safe:1\}/);
  assert.match(helper,/rank\[b\.tone\]>rank\[a\.tone\]/);
  assert.match(helper,/items\.filter\(x=>x!==worst\)\.forEach\(x=>x\.el\.remove\(\)\)/);
  for(const x of ['FEHLER / AKTION','ACHTUNG','PRÜFEN','OK'])assert.ok(helper.includes(x));
});

test('r123 all-clear is strict and neutral',()=>{
  assert.match(helper,/items\.every\(x=>x\.tone==='safe'\)/);
  assert.match(helper,/HOLD · RUNNER WEITERLAUFEN/);
  assert.match(helper,/NICHTS ZU TUN/);
  assert.match(helper,/PORTFOLIO · RISIKO · DATEN geprüft/);
  assert.doesNotMatch(helper,/\b(?:BUY|SELL|LONG|SHORT)\b/i);
});

test('r123 is presentation-only and does not reimplement readiness or risk',()=>{
  for(const x of ['syncHealth','criticalPair','portfolioReadiness','botReadiness','marketReadiness','liquidationDisplayState'])assert.ok(!helper.includes(x));
  assert.doesNotMatch(helper,/(?:fetch\(|postJson|submitOrder|placeOrder|createOrder|cancelOrder|executeTrade|S\(\)|H\(\))/);
  const health=block('function commandHealthSummary()','function commandOverviewHtml()');
  assert.match(health,/rank=\{danger:4,watch:3,muted:2,safe:1\}/);
  assert.match(health,/worst=\[portfolio,riskView,data\]/);
});

test('r123 observer is bounded and rerender-safe',()=>{
  assert.match(helper,/MutationObserver\(schedule\)\.observe\(r,\{childList:true\}\)/);
  assert.doesNotMatch(helper,/subtree:true/);
  assert.match(helper,/health\.dataset\.r123StatusOwner='true'/);
  assert.match(helper,/health\.style\.gridTemplateColumns='1fr'/);
});
